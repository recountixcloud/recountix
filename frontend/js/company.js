/* ==========================================================
   RECOUNTIX - Super Admin Pages
   super-dashboard.html / companies.html / subscription.html
========================================================== */

function fmtMoney(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN");
}

function fmtDate(d) {
    if (!d) return "-";
    const dt = new Date(d);
    if (isNaN(dt)) return "-";
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}


/** Single source of truth for license end date */
function getEffectiveLicenseExpiry(shop, subscription) {
    const a = shop && shop.license_expiry ? String(shop.license_expiry).slice(0, 10) : "";
    const b = subscription && (subscription.end_date || subscription.endDate)
        ? String(subscription.end_date || subscription.endDate).slice(0, 10) : "";
    if (a && b) return a >= b ? a : b; // later date wins
    return b || a || "";
}

function daysLeft(endDate) {
    if (!endDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    return Math.ceil((end - today) / (1000 * 60 * 60 * 24));
}

function statusBadge(status) {
    if (status === "active") return '<span class="badge badge-success">Active</span>';
    if (status === "expiring") return '<span class="badge badge-warning">Expiring Soon</span>';
    return '<span class="badge badge-danger">Expired</span>';
}

/* ================================
   SUPER DASHBOARD
================================ */
async function loadSuperDashboard() {
    const body = document.getElementById("shopOverviewBody");
    if (!body) return;

    try {
        const stats = await sbGetSuperDashboardStats();

        document.getElementById("statTotalShops").innerText = stats.totalShops;
        document.getElementById("statActiveShops").innerText = stats.activeShops;
        document.getElementById("statInactiveShops").innerText = stats.inactiveShops;
        document.getElementById("statExpiring").innerText = stats.expiringSoon + stats.expired;
        document.getElementById("statTotalCustomers").innerText = stats.totalCustomers;
        document.getElementById("statTotalOutstanding").innerText = fmtMoney(stats.totalOutstanding);

        body.innerHTML = stats.shops.map((shop, i) => {
            const status = computeSubStatus(shop.license_expiry || shop.endDate);
            return `<tr>
                <td>${i + 1}</td>
                <td>${shop.name}</td>
                <td>${shop.code}</td>
                <td>${shop.plan_name || "Basic"}</td>
                <td>${fmtDate(shop.license_expiry)}</td>
                <td>${shop.is_active ? statusBadge(status) : '<span class="badge badge-danger">Shop Inactive</span>'}</td>
            </tr>`;
        }).join("") || `<tr><td colspan="6" style="text-align:center;color:#94a3b8;">No shops found</td></tr>`;
    } catch (e) {
        console.error(e);
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;">Failed to load: ${e.message || e}</td></tr>`;
    }
}

/* ================================
   COMPANY MANAGEMENT
================================ */
let allShopsCache = [];

async function loadCompanies() {
    const body = document.getElementById("companiesBody");
    if (!body) return;

    try {
        const rows = await sbGetSubscriptionsWithShops();
        allShopsCache = (rows || []).map(r => {
            const shop = Object.assign({}, r.shop || {});
            shop.license_expiry = r.endDate || shop.license_expiry || "";
            shop.plan_name = (r.subscription && r.subscription.plan_name) || shop.plan_name || "Basic";
            return shop;
        });
        body.innerHTML = rows.map((r, i) => {
            const shop = r.shop;
            const status = r.liveStatus;
            const exp = r.endDate;
            return `<tr>
            <td>${i + 1}</td>
            <td>${shop.name || ""}</td>
            <td>${shop.code || ""}</td>
            <td>${shop.contact_number || "-"}</td>
            <td>${(r.subscription && r.subscription.plan_name) || shop.plan_name || "Basic"}</td>
            <td>${fmtDate(exp)}</td>
            <td>${shop.is_active
                ? statusBadge(status)
                : '<span class="badge badge-danger">Inactive</span>'}</td>
            <td>
                <button type="button" onclick="openEditShopModal('${shop.id}')" title="Edit">✏️</button>
                <button type="button" onclick="toggleShopActiveHandler('${shop.id}', ${shop.is_active ? 'false' : 'true'})" title="Toggle">⏸️</button>
                <button type="button" onclick="deleteShopHandler('${shop.id}')" title="Delete">🗑️</button>
            </td>
        </tr>`;
        }).join("") || `<tr><td colspan="8" style="text-align:center;color:#94a3b8;">No shops yet</td></tr>`;
    } catch (e) {
        console.error(e);
        body.innerHTML = `<tr><td colspan="8" style="color:#ef4444;">Failed: ${e.message || e}</td></tr>`;
    }
}

function renderCompaniesTable() {
    const body = document.getElementById("companiesBody");
    if (!body) return;

    body.innerHTML = allShopsCache.map((shop, i) => {
        const status = computeSubStatus(shop.license_expiry);
        return `<tr>
            <td>${i + 1}</td>
            <td>${shop.name}</td>
            <td>${shop.code}</td>
            <td>${shop.contact_number || "-"}</td>
            <td>${shop.plan_name || "Basic"}</td>
            <td>${fmtDate(shop.license_expiry)}</td>
            <td>${shop.is_active
                ? '<span class="badge badge-success">Active</span>'
                : '<span class="badge badge-danger">Inactive</span>'}
                ${shop.is_active && status !== "active" ? "<br>" + statusBadge(status) : ""}
            </td>
            <td>
                <button class="btn-reset" style="border-radius:6px;padding:6px 10px;" onclick="openEditShopModal('${shop.id}')">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-reset" style="border-radius:6px;padding:6px 10px;background:${shop.is_active ? "#f59e0b" : "#16a34a"};"
                    onclick="toggleShopActiveHandler('${shop.id}', ${!shop.is_active})">
                    <i class="fa-solid ${shop.is_active ? "fa-ban" : "fa-check"}"></i>
                </button>
                <button class="btn-reset" style="border-radius:6px;padding:6px 10px;background:#ef4444;" onclick="deleteShopHandler('${shop.id}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    }).join("") || `<tr><td colspan="8" style="text-align:center;color:#94a3b8;">No shops yet. Click "Add Jewellery" to create one.</td></tr>`;
}

function openAddShopModal() {
    document.getElementById("shopModalTitle").innerText = "Add Jewellery Shop";
    document.getElementById("shopId").value = "";
    document.getElementById("shopName").value = "";
    document.getElementById("shopCode").value = "";
    document.getElementById("shopContact").value = "";
    document.getElementById("shopEmail").value = "";
    document.getElementById("shopAddress").value = "";
    document.getElementById("shopPlan").value = "Basic";
    document.getElementById("shopLicenseExpiry").value = "";
    document.getElementById("shopMaxUsers").value = "5";
    document.getElementById("shopAdminUsername").value = "";
    document.getElementById("shopAdminPassword").value = "";
    document.getElementById("shopAdminName").value = "";
    document.getElementById("newShopAdminBlock").style.display = "block";
    document.getElementById("shopCode").disabled = false;
    document.getElementById("shopModal").style.display = "block";
}

function openEditShopModal(shopId) {
    const shop = allShopsCache.find(s => s.id === shopId);
    if (!shop) return;

    document.getElementById("shopModalTitle").innerText = "Edit Shop";
    document.getElementById("shopId").value = shop.id;
    document.getElementById("shopName").value = shop.name || "";
    document.getElementById("shopCode").value = shop.code || "";
    document.getElementById("shopCode").disabled = true;
    document.getElementById("shopContact").value = shop.contact_number || "";
    document.getElementById("shopEmail").value = shop.email || "";
    document.getElementById("shopAddress").value = shop.address || "";
    document.getElementById("shopPlan").value = shop.plan_name || "Basic";
    document.getElementById("shopLicenseExpiry").value = shop.license_expiry || "";
    document.getElementById("shopMaxUsers").value = shop.max_users || 5;
    document.getElementById("newShopAdminBlock").style.display = "none";
    document.getElementById("shopModal").style.display = "block";
}

function closeShopModal() {
    document.getElementById("shopModal").style.display = "none";
}

async function saveShop() {
    const shopId = document.getElementById("shopId").value;
    const form = {
        name: document.getElementById("shopName").value,
        code: document.getElementById("shopCode").value,
        contact: document.getElementById("shopContact").value,
        email: document.getElementById("shopEmail").value,
        address: document.getElementById("shopAddress").value,
        plan: document.getElementById("shopPlan").value,
        licenseExpiry: document.getElementById("shopLicenseExpiry").value,
        maxUsers: document.getElementById("shopMaxUsers").value,
        adminUsername: document.getElementById("shopAdminUsername") ? document.getElementById("shopAdminUsername").value : "",
        adminPassword: document.getElementById("shopAdminPassword") ? document.getElementById("shopAdminPassword").value : "",
        adminName: document.getElementById("shopAdminName") ? document.getElementById("shopAdminName").value : ""
    };

    try {
        if (shopId) {
            await sbUpdateShop(shopId, form);
        } else {
            await sbAddShop(form);
        }
        closeShopModal();
        await loadCompanies();
        alert("Shop saved successfully.");
    } catch (e) {
        console.error(e);
        alert("Save failed: " + (e.message || e));
    }
}

async function toggleShopActiveHandler(shopId, makeActive) {
    const action = makeActive ? "activate" : "deactivate";
    if (!confirm(`Are you sure you want to ${action} this shop? Shop Admin login will ${makeActive ? "be restored" : "stop working"}.`)) return;
    try {
        await sbToggleShopActive(shopId, makeActive);
        await loadCompanies();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

async function deleteShopHandler(shopId) {
    if (!confirm("This will permanently delete the shop and ALL its customers/recoveries. Continue?")) return;
    if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
    try {
        await sbDeleteShop(shopId);
        await loadCompanies();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

window.openAddShopModal = openAddShopModal;
window.openEditShopModal = openEditShopModal;
window.closeShopModal = closeShopModal;
window.saveShop = saveShop;
window.toggleShopActiveHandler = toggleShopActiveHandler;
window.deleteShopHandler = deleteShopHandler;

/* ================================
   SUBSCRIPTION PAGE
================================ */
async function loadSubscriptions() {
    const body = document.getElementById("subscriptionBody");
    if (!body) return;

    try {
        const rows = await sbGetSubscriptionsWithShops();

        let active = 0, expiring = 0, expired = 0;
        rows.forEach(r => {
            if (r.liveStatus === "active") active++;
            else if (r.liveStatus === "expiring") expiring++;
            else expired++;
        });
        document.getElementById("subActiveCount").innerText = active;
        document.getElementById("subExpiringCount").innerText = expiring;
        document.getElementById("subExpiredCount").innerText = expired;

        body.innerHTML = rows.map((r, i) => {
            const dl = daysLeft(r.endDate);
            return `<tr>
                <td>${i + 1}</td>
                <td>${r.shop.name}</td>
                <td>${(r.subscription && r.subscription.plan_name) || r.shop.plan_name || "Basic"}</td>
                <td>${fmtDate(r.endDate)}</td>
                <td>${dl === null ? "-" : (dl < 0 ? Math.abs(dl) + " days overdue" : dl + " days")}</td>
                <td>${statusBadge(r.liveStatus)}</td>
                <td>${r.shop.is_active
                    ? '<span class="badge badge-success">Active</span>'
                    : '<span class="badge badge-danger">Inactive</span>'}</td>
                <td>
                    <button class="add-btn" style="padding:8px 14px;font-size:13px;" onclick="openRenewModal('${r.shop.id}', '${(r.shop.name || "").replace(/'/g, "")}', '${r.subscription ? r.subscription.plan_name : (r.shop.plan_name || "Basic")}')">
                        <i class="fa-solid fa-rotate"></i> Renew
                    </button>
                </td>
            </tr>`;
        }).join("") || `<tr><td colspan="8" style="text-align:center;color:#94a3b8;">No shops found</td></tr>`;
    } catch (e) {
        console.error(e);
        body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#ef4444;">Failed to load: ${e.message || e}</td></tr>`;
    }
}

function openRenewModal(shopId, shopName, currentPlan) {
    document.getElementById("renewShopId").value = shopId;
    document.getElementById("renewShopName").innerText = shopName;
    document.getElementById("renewPlan").value = currentPlan || "Basic";
    document.getElementById("renewAmount").value = "";
    document.getElementById("renewRemarks").value = "";

    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    document.getElementById("renewEndDate").value = nextYear.toISOString().split("T")[0];

    document.getElementById("renewModal").style.display = "block";
}

function closeRenewModal() {
    document.getElementById("renewModal").style.display = "none";
}

async function renewLicenseDirectly(shopId, form) {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase not ready");
    const payload = {
        license_expiry: form.endDate,
        plan_name: form.plan || "Basic",
        is_active: true,
        updated_at: new Date().toISOString()
    };
    const { error } = await sb.from("shops").update(payload).eq("id", shopId);
    if (error) throw error;

    try {
        await sb.from("subscriptions").insert({
            shop_id: shopId,
            plan_name: form.plan || "Basic",
            amount: Number(form.amount || 0),
            start_date: new Date().toISOString().slice(0, 10),
            end_date: form.endDate,
            status: "active",
            remarks: form.remarks || ""
        });
    } catch (subErr) {
        console.warn("Subscription history insert skipped, license was renewed on shop row", subErr);
    }
    try {
        if (typeof sbAddAuditLog === "function") {
            await sbAddAuditLog("subscription.renew", "shop", shopId, "Renewed license until " + form.endDate, shopId);
        }
    } catch (auditErr) {
        console.warn("Audit log skipped", auditErr);
    }
    return true;
}

async function confirmRenewSubscription() {
    const shopId = document.getElementById("renewShopId").value;
    const btn = document.querySelector("#renewModal .add-btn");
    const form = {
        plan: document.getElementById("renewPlan").value,
        amount: document.getElementById("renewAmount").value,
        endDate: document.getElementById("renewEndDate").value,
        remarks: document.getElementById("renewRemarks").value
    };
    if (!shopId) {
        alert("Shop not found. Please reopen renewal.");
        return;
    }
    if (!form.endDate) {
        alert("Please choose a new expiry date");
        return;
    }
    try {
        if (btn) {
            btn.disabled = true;
            btn.dataset.oldText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Renewing...';
        }
        try {
            await sbRenewSubscription(shopId, form);
        } catch (primaryErr) {
            console.warn("Primary renewal failed, trying direct license update", primaryErr);
            await renewLicenseDirectly(shopId, form);
        }
        closeRenewModal();
        await loadSubscriptions();
        if (document.getElementById("companiesBody")) await loadCompanies();
        if (document.getElementById("shopOverviewBody")) await loadSuperDashboard();
        alert("Subscription renewed successfully.");
    } catch (e) {
        alert("Renewal failed: " + (e.message || e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.oldText || '<i class="fa-solid fa-rotate"></i> Confirm Renewal';
        }
    }
}

window.openRenewModal = openRenewModal;
window.closeRenewModal = closeRenewModal;
window.confirmRenewSubscription = confirmRenewSubscription;
window.renewLicenseDirectly = renewLicenseDirectly;

/* ================================
   INIT
================================ */
window.addEventListener("load", async function () {
    // give script.js's checkLogin()/session boot a tick to run first
    setTimeout(async () => {
        if (document.getElementById("shopOverviewBody")) await loadSuperDashboard();
        if (document.getElementById("companiesBody")) await loadCompanies();
        if (document.getElementById("subscriptionBody")) await loadSubscriptions();
    }, 300);
});
