/* Password rules are enforced here for UX; hashing is server-side bcrypt only. */
const MIN_PASSWORD_LEN = 8;
const MIN_SUPERADMIN_PASSWORD_LEN = 12;

function authEscape(value) {
    if (typeof escapeHtml === "function") {
        return escapeHtml(value == null ? "" : String(value));
    }
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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

    try {
        const { data: rpcData, error: rpcErr } = await sb.rpc("app_login", {
            p_username: uname,
            p_password: plain
        });
        if (!rpcErr && rpcData && rpcData.error) {
            const messages = {
                invalid_credentials: "Invalid Username or Password",
                temporarily_locked: "Too many failed attempts. Try again after 15 minutes.",
                shop_inactive: "This business is deactivated. Please contact Super Admin.",
                license_expired: "The business license has expired. Contact Super Admin."
            };
            return { error: rpcData.error, message: messages[rpcData.error] || "Login failed." };
        }
        if (!rpcErr && rpcData && rpcData.token) {
            const u = rpcData.user || {};
            let shop = null;
            if (u.shop_id) {
                try {
                    const { data: shops } = await sb.rpc("app_get_shops", { p_token: rpcData.token });
                    shop = (shops || []).find(s => String(s.id) === String(u.shop_id)) || (shops && shops[0]) || null;
                } catch (e) {
                    throw new Error("Secure business verification failed");
                }
            }

            if (shop && shop.is_active === false && u.role !== "super_admin") {
                return { error: "shop_inactive", message: "This business is deactivated. Please contact Super Admin." };
            }
            if (shop && shop.license_expiry && u.role !== "super_admin") {
                const st = (typeof computeSubStatus === "function")
                    ? computeSubStatus(shop.license_expiry)
                    : "unknown";
                if (st === "expired") {
                    return {
                        error: "license_expired",
                        message: "The business license has expired.\n\nLogin is disabled.\nA Super Admin can renew it from the Subscription page."
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

    throw new Error("Secure login service is unavailable. Contact the administrator.");
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

async function enforceMaintenanceGate(options) {
    options = options || {};
    const page = String(window.location.pathname || "").toLowerCase();
    if (page.includes("maintenance.html")) return false;

    const session = (typeof getSession === "function") ? getSession() : null;

    if (!page.includes("login.html")) {
        if (!session || !session.isLoggedIn || !session.sessionToken) {
            try { clearSession(); } catch (_) {}
            window.location.replace("login.html");
            return true;
        }
        try {
            const { data, error } = await getSupabase().rpc("app_validate_session", {
                p_token: session.sessionToken
            });
            if (error || !data || data.valid !== true) {
                try { clearSession(); } catch (_) {}
                window.location.replace("login.html");
                return true;
            }
            const verified = data.user || {};
            if (verified.role !== session.role ||
                String(verified.shop_id || "") !== String(session.shopId || "") ||
                String(verified.id || "") !== String(session.userId || "")) {
                try { clearSession(); } catch (_) {}
                window.location.replace("login.html");
                return true;
            }
        } catch (verifyError) {
            console.error("Session verification failed", verifyError);
            try { clearSession(); } catch (_) {}
            window.location.replace("login.html");
            return true;
        }
    }

    if (session && session.role === "super_admin") return false;

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
            try { if (typeof clearSession === "function") clearSession(); } catch (_) {}
            window.location.replace("maintenance.html");
            return true;
        }
    } catch (e) {
        console.error("Maintenance gate check failed", e);
        if (!page.includes("login.html")) {
            try { sessionStorage.setItem("bk_maintenance_message", "The system status could not be verified. Please try again later."); } catch (_) {}
            try { if (typeof clearSession === "function") clearSession(); } catch (_) {}
            window.location.replace("maintenance.html");
            return true;
        }
    }
    return false;
}

(function installGlobalMaintenanceGate(){
    const run = async function(){
        const page = String(window.location.pathname || "").toLowerCase();
        if (page.includes("maintenance.html") || page.includes("login.html")) return;
        try { await enforceMaintenanceGate(); } catch (e) { console.error(e); }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once:true });
    else setTimeout(run, 0);
    document.addEventListener("visibilitychange", function(){ if (!document.hidden) run(); });
    setInterval(run, 15000);
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
    const dataPages = ["customers.html", "recovery.html", "ptp.html", "escalations.html", "activity.html", "field-tracking.html", "reports.html"];
    if (role === "super_admin" && dataPages.some(p => page.includes(p)) && !session.shopId) {
        try { sessionStorage.setItem("sa-privacy-customers", "1"); } catch (e) {}
    }

    if (page.includes("settings.html") && role !== "admin" && role !== "super_admin" && !window.RecountixPermissions) {
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
            <span>${authEscape(link.label)}</span>
        </a>`;
        if (logoutLi) menu.insertBefore(li, logoutLi);
        else menu.appendChild(li);
    });

    menu.dataset.superAdminInjected = "true";
}

function applyRoleRestrictions() {
    const session = getSession();

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
                brand.innerHTML = '<img src="assets/logo.png" alt="Recountix"><div class="vo-topbar-brand-name">RECOUNTIX<small>BEYOND WHAT&apos;S DUE.</small></div>';
                header.insertBefore(brand, header.firstChild);
            }
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
        shopLabel.innerText = session.shopName || (role === "super_admin" ? "All Businesses" : "");
    }

    if (role === "admin" || role === "super_admin") return;

    document.querySelectorAll('a[href="settings.html"]').forEach(link => {
        link.style.display = window.rxCan && rxCan("settings") ? "" : "none";
    });

    const userMgmt = document.getElementById("userManagementSection");
    if (userMgmt) userMgmt.style.display = "none";
}

async function logout() {
    if (!confirm("Are you sure you want to logout?")) return;
    try {
        const session = getSession();
        if (session.sessionToken) {
            await getSupabase().rpc("app_logout", { p_token: session.sessionToken });
        }
    } catch (e) {
        console.warn("Server logout failed", e);
    } finally {
        clearSession();
        window.location.replace("login.html");
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
    showLoginError("Contact your Business Administrator or Super Admin to reset your password securely.");
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
