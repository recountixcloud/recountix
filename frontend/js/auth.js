
/* ========== Password security (SHA-256 + app pepper) ========== */
const PASSWORD_PEPPER = "VO-RM-v1-";
const MIN_PASSWORD_LEN = 8;
const MIN_SUPERADMIN_PASSWORD_LEN = 12;

async function hashPassword(plain) {
    const text = PASSWORD_PEPPER + String(plain || "");
    if (window.crypto && crypto.subtle) {
        const data = new TextEncoder().encode(text);
        const buf = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(buf))
            .map(function (b) { return b.toString(16).padStart(2, "0"); })
            .join("");
    }
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return "fallback_" + Math.abs(hash).toString(16);
}

function isHashedPassword(stored) {
    if (!stored || typeof stored !== "string") return false;
    return /^[a-f0-9]{64}$/i.test(stored.trim());
}

function validatePasswordStrength(password, role) {
    const p = String(password || "");
    const isSuper = role === "super_admin";
    const min = isSuper ? MIN_SUPERADMIN_PASSWORD_LEN : MIN_PASSWORD_LEN;
    if (p.length < min) {
        return {
            ok: false,
            message: isSuper
                ? ("Super Admin password must be at least " + min + " characters.")
                : ("Password must be at least " + min + " characters.")
        };
    }
    if (isSuper) {
        const hasLetter = /[a-zA-Z]/.test(p);
        const hasNumber = /[0-9]/.test(p);
        const hasSpecial = /[^a-zA-Z0-9]/.test(p);
        if (!hasLetter || !hasNumber || !hasSpecial) {
            return {
                ok: false,
                message: "Super Admin password must include a letter, a number, and a special character (e.g. @#$)."
            };
        }
        const weak = ["1234", "123456", "password", "admin", "superadmin", "admin@123"];
        if (weak.some(function (w) { return p.toLowerCase().indexOf(w) >= 0; })) {
            return { ok: false, message: "Password is too weak or common. Please choose a stronger password." };
        }
    }
    return { ok: true };
}

window.hashPassword = hashPassword;
window.isHashedPassword = isHashedPassword;
window.validatePasswordStrength = validatePasswordStrength;

/* ==========================================================
   Recountix – Authentication
========================================================== */

async function sbLogin(username, password) {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase not ready");

    const plain = String(password || "").trim();
    const uname = String(username || "").trim();
    if (!uname || !plain) return null;

    // Preferred: secure RPC login (RLS session token)
    try {
        const { data: rpcData, error: rpcErr } = await sb.rpc("app_login", {
            p_username: uname,
            p_password: plain
        });
        if (!rpcErr && rpcData && rpcData.token) {
            const u = rpcData.user || {};
            let shop = null;
            if (u.shop_id) {
                try {
                    const { data: shops } = await sb.rpc("app_get_shops", { p_token: rpcData.token });
                    shop = (shops || []).find(s => String(s.id) === String(u.shop_id)) || (shops && shops[0]) || null;
                } catch (e) {
                    const { data: s } = await sb.from("shops").select("*").eq("id", u.shop_id).maybeSingle();
                    shop = s;
                }
            }

            // IMPORTANT: the RPC path must enforce the same shop-status checks as
            // the fallback path below — otherwise a deactivated / expired shop's
            // users could still log in whenever app_login succeeds.
            if (shop && shop.is_active === false && u.role !== "super_admin") {
                return { error: "shop_inactive", message: "This shop is deactivated. Please contact Super Admin." };
            }
            if (shop && shop.license_expiry && u.role !== "super_admin") {
                const st = (typeof computeSubStatus === "function")
                    ? computeSubStatus(shop.license_expiry)
                    : "unknown";
                if (st === "expired") {
                    return {
                        error: "license_expired",
                        message: "The shop license has expired.\n\nLogin is disabled.\nA Super Admin can renew it from the Subscription page."
                    };
                }
            }

            return {
                user: {
                    id: u.id,
                    username: u.username,
                    role: u.role,
                    shop_id: u.shop_id,
                    display_name: u.display_name
                },
                shop: shop,
                sessionToken: rpcData.token
            };
        }
    } catch (rpcCatch) {
        console.warn("app_login RPC not available, fallback", rpcCatch);
    }

    // Fallback: direct users table (before RLS / if RPC missing)
    const { data, error } = await sb
        .from("users")
        .select("id, username, password, role, shop_id, display_name, is_active")
        .eq("username", uname)
        .eq("is_active", true)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const stored = String(data.password || "");
    const hashedInput = await hashPassword(plain);
    let matched = false;

    if (isHashedPassword(stored)) {
        matched = (stored.toLowerCase() === hashedInput.toLowerCase());
    } else {
        // Legacy plain-text password — verify then upgrade to hash
        matched = (stored === plain);
        if (matched) {
            try {
                await sb.from("users").update({ password: hashedInput }).eq("id", data.id);
                data.password = hashedInput;
            } catch (upErr) {
                console.warn("password upgrade failed", upErr);
            }
        }
    }

    if (!matched) return null;

    // Do not keep password on session object
    try { delete data.password; } catch (e) { data.password = undefined; }

    let shop = null;
    if (data.shop_id) {
        const { data: s, error: se } = await sb.from("shops").select("*").eq("id", data.shop_id).maybeSingle();
        if (se) throw se;
        shop = s;
        if (shop && shop.is_active === false) {
            return { error: "shop_inactive", message: "This shop is deactivated. Please contact Super Admin." };
        }
        if (shop && shop.license_expiry) {
            const st = (typeof computeSubStatus === "function")
                ? computeSubStatus(shop.license_expiry)
                : "unknown";
            if (st === "expired" && data.role !== "super_admin") {
                return {
                    error: "license_expired",
                    message: "The shop license has expired.\n\nLogin is disabled.\nA Super Admin can renew it from the Subscription page."
                };
            }
        }
    }

    return { user: data, shop };
}

async function login() {
    const usernameEl = document.getElementById("username");
    const passwordEl = document.getElementById("password");
    if (!usernameEl || !passwordEl) return;

    const user = usernameEl.value.trim();
    const pass = passwordEl.value.trim();
    if (!user || !pass) {
        alert("Please enter username and password");
        return;
    }

    const remember = !!(document.getElementById("rememberMe") && document.getElementById("rememberMe").checked);
    const btn = document.querySelector(".login-box button[type='button'], .login-box button.login-btn, #loginBtn");
    if (btn) {
        btn.disabled = true;
        btn.dataset._old = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
    }

    try {
        const result = await sbLogin(user, pass);
        if (!result) {
            showLoginError("Invalid Username or Password");
            return;
        }
        if (result.error) {
            showLoginError(result.message || result.error);
            return;
        }
        // Maintenance gate: allow Super Admin, block every other user while maintenance is ON.
        if (result.user.role !== "super_admin") {
            try {
                const maintenance = await sbGetMaintenanceStatus();
                if (maintenance && maintenance.enabled === true) {
                    try { clearSession(); } catch (_) {}
                    sessionStorage.setItem("bk_maintenance_message", maintenance.message || "Our system is currently being updated. Please try again shortly.");
                    window.location.replace("maintenance.html");
                    return;
                }
            } catch (maintenanceErr) {
                console.error("Maintenance check failed during login", maintenanceErr);
                showLoginError("System status check failed. Please try again.");
                return;
            }
        }

        setSession(result.user, result.shop, remember, result.sessionToken || result.token || "");
        if (result.user.role === "super_admin") {
            window.location.href = "super-dashboard.html";
        } else {
            window.location.href = "dashboard.html";
        }
    } catch (e) {
        console.error(e);
        showLoginError(e.message || "Login failed. Check network / cloud connection.");
    } finally {
        if (btn) {
            btn.disabled = false;
            if (btn.dataset._old) btn.innerHTML = btn.dataset._old;
        }
    }
}


// Global maintenance guard for users who were already logged in before maintenance was enabled.
async function enforceMaintenanceGate(options) {
    options = options || {};
    const page = String(window.location.pathname || "").toLowerCase();
    if (page.includes("maintenance.html")) return false;

    const session = (typeof getSession === "function") ? getSession() : null;
    // Only a real logged-in Super Admin bypasses maintenance.
    if (session && session.isLoggedIn && session.role === "super_admin") return false;

    // Login page remains visible so Super Admin can sign in, but normal-user
    // credentials are blocked separately in login().
    if (page.includes("login.html") && !options.forceOnLogin) return false;

    try {
        if (typeof sbGetMaintenanceStatus !== "function") {
            throw new Error("Maintenance status function unavailable");
        }
        const maintenance = await sbGetMaintenanceStatus();
        if (maintenance && maintenance.enabled === true) {
            try {
                sessionStorage.setItem("bk_maintenance_message", maintenance.message || "Our system is currently being updated. Please try again shortly.");
            } catch (_) {}
            // Clear normal-user session so Back button cannot reopen protected pages.
            try { if (typeof clearSession === "function") clearSession(); } catch (_) {}
            window.location.replace("maintenance.html");
            return true;
        }
    } catch (e) {
        console.error("Maintenance gate check failed", e);
        // Protected pages fail closed for non-super-admin users. This prevents
        // an RLS/network/status-read failure from silently bypassing maintenance.
        if (!page.includes("login.html")) {
            try { sessionStorage.setItem("bk_maintenance_message", "The system status could not be verified. Please try again later."); } catch (_) {}
            try { if (typeof clearSession === "function") clearSession(); } catch (_) {}
            window.location.replace("maintenance.html");
            return true;
        }
    }
    return false;
}

// Hard global maintenance gate: run independently of app.js so every protected
// HTML page is checked even if that page's normal application init changes/fails.
(function installGlobalMaintenanceGate(){
    const run = async function(){
        const page = String(window.location.pathname || "").toLowerCase();
        if (page.includes("maintenance.html") || page.includes("login.html")) return;
        try { await enforceMaintenanceGate(); } catch (e) { console.error(e); }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once:true });
    else setTimeout(run, 0);
    // Re-check when user returns to the tab and periodically while logged in.
    document.addEventListener("visibilitychange", function(){ if (!document.hidden) run(); });
    setInterval(function(){ if (!document.hidden) run(); }, 60000);
})();

function checkLogin() {
    const page = window.location.pathname;
    if (page.includes("login.html") || page.endsWith("/") || page.endsWith("/frontend")) return;

    const session = getSession();
    if (!session.isLoggedIn) {
        window.location.href = "login.html";
        return;
    }

    const role = session.role;
    // Super Admin: customer/recovery data pages — privacy (no cross-shop customer view)
    const dataPages = ["customers.html", "recovery.html", "ptp.html", "escalations.html", "activity.html", "field-tracking.html", "reports.html"];
    if (role === "super_admin" && dataPages.some(p => page.includes(p)) && !session.shopId) {
        // stay but privacy banner + empty data via enforceSuperAdminDataPrivacy; do not redirect forced
        try { sessionStorage.setItem("sa-privacy-customers", "1"); } catch (e) {}
    }

    if (page.includes("settings.html") && role !== "admin" && role !== "super_admin") {
        alert("Access Denied. Settings is available to Admin only.");
        window.location.href = "dashboard.html";
        return;
    }

    const superAdminOnlyPages = ["super-dashboard.html", "companies.html", "subscription.html", "ad-manager.html"];
    if (superAdminOnlyPages.some(p => page.includes(p)) && role !== "super_admin") {
        alert("Access Denied. This section is available to Super Admin only.");
        window.location.href = "dashboard.html";
        return;
    }

    applyRoleRestrictions();
    injectSuperAdminNav();
}

function injectSuperAdminNav() {
    const session = getSession();
    if (session.role !== "super_admin") return;

    const menu = document.querySelector(".sidebar .menu");
    if (!menu || menu.dataset.superAdminInjected) return;

    const page = window.location.pathname;
    const links = [
        { href: "super-dashboard.html", icon: "fa-chart-pie", label: "Super Dashboard" },
        { href: "companies.html", icon: "fa-building", label: "Company Management" },
        { href: "subscription.html", icon: "fa-file-invoice-dollar", label: "Subscription" },
        { href: "ad-manager.html", icon: "fa-rectangle-ad", label: "Ad Manager" }
    ];

    const logoutLi = Array.from(menu.children).find(li => li.querySelector('a[onclick*="logout"]'));

    links.forEach(link => {
        const li = document.createElement("li");
        const isActive = page.includes(link.href);
        li.innerHTML = `<a href="${link.href}"${isActive ? ' class="active"' : ""}>
            <i class="fa-solid ${link.icon}"></i>
            <span>${link.label}</span>
        </a>`;
        if (logoutLi) menu.insertBefore(li, logoutLi);
        else menu.appendChild(li);
    });

    menu.dataset.superAdminInjected = "true";
}

function applyRoleRestrictions() {
    const session = getSession();

    // Final UI identity: show the logged-in user's name on the left sidebar and topbar brand.
    try {
        const sidebar = document.querySelector(".sidebar");
        if (sidebar && !sidebar.querySelector(".vo-logged-user")) {
            const logo = sidebar.querySelector(".logo");
            const box = document.createElement("div");
            box.className = "vo-logged-user";
            box.innerHTML = '<i class="fa-solid fa-user-check"></i><span><b id="loggedInUserName"></b><small>Logged in</small></span>';
            if (logo) logo.insertAdjacentElement("afterend", box);
            else sidebar.prepend(box);
        }
        const name = session.displayName || session.username || "User";
        const leftName = document.getElementById("loggedInUserName");
        if (leftName) leftName.textContent = name;

        document.querySelectorAll(".topbar,.header-bar,.page-header").forEach(function(header){
            if (!header.querySelector(".vo-topbar-brand")) {
                const brand = document.createElement("div");
                brand.className = "vo-topbar-brand";
                brand.innerHTML = '<div class="vo-topbar-brand-name">RECOUNTIX<small>BEYOND WHAT&apos;S DUE.</small></div>';
                header.insertBefore(brand, header.firstChild);
            }
            // Keep top headers clean and premium: no role/name chips in the upper bar.
            header.querySelectorAll(".vo-topbar-user, .user-info").forEach(function(el){ el.remove(); });
        });
    } catch (e) { console.warn("Final identity UI failed", e); }
    const role = session.role || "user";

    const badge = document.getElementById("userRoleBadge");
    if (badge) {
        if (role === "super_admin") badge.innerText = "Super Admin";
        else if (role === "admin") badge.innerText = "Administrator";
        else badge.innerText = "User";
    }

    const roleDisplay = document.getElementById("currentRoleDisplay");
    if (roleDisplay) {
        roleDisplay.value = role === "super_admin" ? "Super Admin" : (role === "admin" ? "Administrator" : "User");
    }

    const shopLabel = document.getElementById("currentShopName");
    if (shopLabel) {
        shopLabel.innerText = session.shopName || (role === "super_admin" ? "All Shops" : "");
    }

    if (role === "admin" || role === "super_admin") return;

    document.querySelectorAll('a[href="settings.html"]').forEach(link => {
        link.style.display = "none";
    });

    const userMgmt = document.getElementById("userManagementSection");
    if (userMgmt) userMgmt.style.display = "none";
}

function logout() {
    if (confirm("Are you sure you want to logout?")) {
        clearSession();
        window.location.href = "login.html";
    }
}


function openForgotPassword() {
    const modal = document.getElementById("forgotModal");
    if (!modal) {
        alert("Forgot Password form not found.");
        return;
    }
    modal.classList.add("show");
    modal.style.display = "flex";
    ["forgotUsername","forgotEmail","forgotNewPass","forgotConfirmPass"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
}

function closeForgotPassword() {
    const modal = document.getElementById("forgotModal");
    if (!modal) return;
    modal.classList.remove("show");
    modal.style.display = "none";
}

async function submitForgotPassword() {
    const username = (document.getElementById("forgotUsername")?.value || "").trim();
    const email = (document.getElementById("forgotEmail")?.value || "").trim().toLowerCase();
    const newPass = document.getElementById("forgotNewPass")?.value || "";
    const confirmPass = document.getElementById("forgotConfirmPass")?.value || "";

    if (!username) {
        alert("Please enter username.");
        return;
    }
    if (!email) {
        alert("Please enter recovery email.\n\nUse the Recovery Email saved in Settings.");
        return;
    }
    if (newPass !== confirmPass) {
        alert("New password and confirm password do not match.");
        return;
    }

    try {
        const sb = getSupabase();
        if (!sb) {
            alert("Cloud connection failed.");
            return;
        }

        const { data: user, error } = await sb
            .from("users")
            .select("id, username, role, shop_id, recovery_email, is_active")
            .eq("username", username)
            .maybeSingle();

        if (error) throw error;
        if (!user) {
            alert("Username not found.");
            return;
        }
        if (user.is_active === false) {
            alert("Account is inactive. Contact Super Admin.");
            return;
        }

        // Allowed emails: user recovery + shop register email + settings emails
        const allowed = new Set();
        if (user.recovery_email) {
            allowed.add(String(user.recovery_email).trim().toLowerCase());
        }
        if (user.shop_id) {
            const { data: shop } = await sb.from("shops")
                .select("email")
                .eq("id", user.shop_id)
                .maybeSingle();
            if (shop && shop.email) {
                allowed.add(String(shop.email).trim().toLowerCase());
            }
            const { data: st } = await sb.from("settings")
                .select("recovery_email, email")
                .eq("shop_id", user.shop_id)
                .maybeSingle();
            if (st) {
                if (st.recovery_email) allowed.add(String(st.recovery_email).trim().toLowerCase());
                if (st.email) allowed.add(String(st.email).trim().toLowerCase());
            }
        }
        if (user.role === "super_admin") {
            const { data: shops } = await sb.from("shops").select("email").limit(50);
            (shops || []).forEach(sh => {
                if (sh.email) allowed.add(String(sh.email).trim().toLowerCase());
            });
            const { data: anySt } = await sb.from("settings").select("recovery_email, email").limit(50);
            (anySt || []).forEach(x => {
                if (x.recovery_email) allowed.add(String(x.recovery_email).trim().toLowerCase());
                if (x.email) allowed.add(String(x.email).trim().toLowerCase());
            });
        }
        allowed.delete("");
        if (!allowed.size) {
            alert("No registered email for this account.\nAdd shop Email in Company Management.");
            return;
        }
        if (!allowed.has(email)) {
            alert("Email does not match.\nUse the email saved at company registration.");
            return;
        }

        const strength = validatePasswordStrength(newPass, user.role || "user");
        if (!strength.ok) {
            alert(strength.message);
            return;
        }

        const { error: upErr } = await sb
            .from("users")
            .update({ password: await hashPassword(newPass) })
            .eq("id", user.id);

        if (upErr) throw upErr;

        alert("✅ Password reset successful!\n\nUsername: " + username + "\nPlease login with the new password.");
        closeForgotPassword();
        const passInput = document.getElementById("password") || document.querySelector('input[type="password"]');
        const userInput = document.getElementById("username") || document.querySelector('input[type="text"]');
        if (userInput) userInput.value = username;
        if (passInput) passInput.value = "";
    } catch (e) {
        console.error(e);
        alert("Reset failed: " + (e.message || e));
    }
}


window.sbLogin = sbLogin;
window.login = login;
window.checkLogin = checkLogin;
window.enforceMaintenanceGate = enforceMaintenanceGate;
window.injectSuperAdminNav = typeof injectSuperAdminNav === "function" ? injectSuperAdminNav : undefined;
window.applyRoleRestrictions = typeof applyRoleRestrictions === "function" ? applyRoleRestrictions : undefined;
window.logout = logout;

window.openForgotPassword = openForgotPassword;
window.closeForgotPassword = closeForgotPassword;
window.submitForgotPassword = submitForgotPassword;


function showLoginError(msg) {
    let box = document.getElementById("loginErrorBox");
    if (!box) {
        box = document.createElement("div");
        box.id = "loginErrorBox";
        box.style.cssText = "margin-top:14px;padding:12px 14px;border-radius:12px;background:#fef2f2;color:#b91c1c;font-size:13px;text-align:left;border:1px solid #fecaca;white-space:pre-line;";
        const card = document.querySelector(".login-card") || document.body;
        const btn = document.getElementById("loginBtn");
        if (btn && btn.parentNode) btn.parentNode.insertBefore(box, btn.nextSibling);
        else card.appendChild(box);
    }
    box.textContent = msg;
    box.style.display = "block";
    try { alert(msg); } catch (e) {}
}
window.showLoginError = showLoginError;
