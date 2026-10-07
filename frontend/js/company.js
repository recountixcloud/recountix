/* ==========================================================
   RECOUNTIX - Super Admin Pages
   super-dashboard.html / companies.html / subscription.html
========================================================== */

function companyEscape(value) {
    return escapeHtml(value == null ? "" : String(value));
}

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
                <td>${companyEscape(shop.name)}</td>
                <td><span class="rx-business-type">${companyEscape(shop.business_type || "Other")}</span></td>
                <td>${companyEscape(shop.code)}</td>
                <td>${companyEscape(shop.plan_name || "Basic")}</td>
                <td>${fmtDate(shop.license_expiry)}</td>
                <td>${shop.is_active ? statusBadge(status) : '<span class="badge badge-danger">Business Inactive</span>'}</td>
            </tr>`;
        }).join("") || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;">No businesses found</td></tr>`;
    } catch (e) {
        console.error(e);
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;">Failed to load: ${companyEscape(e.message || e)}</td></tr>`;
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

        // Keep the exact rows rendered in the table available to the Edit action.
        // Previously this cache stayed empty, so tapping the pencil could not
        // locate the selected shop and silently returned without opening.
        allShopsCache = rows.map((r) => ({
            ...(r.shop || {}),
            plan_name: (r.subscription && r.subscription.plan_name) || (r.shop && r.shop.plan_name) || "Basic",
            license_expiry: r.endDate || (r.shop && r.shop.license_expiry) || ""
        }));

        body.innerHTML = rows.map((r, i) => {
            const shop = r.shop;
            const status = r.liveStatus;
            const exp = r.endDate;
            return `<tr>
            <td>${i + 1}</td>
            <td>${companyEscape(shop.name || "")}</td>
            <td><span class="rx-business-type">${companyEscape(shop.business_type || "Other")}</span></td>
            <td>${companyEscape(shop.code || "")}</td>
            <td>${companyEscape(shop.contact_number || "-")}</td>
            <td>${companyEscape((r.subscription && r.subscription.plan_name) || shop.plan_name || "Basic")}</td>
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
        }).join("") || `<tr><td colspan="9" style="text-align:center;color:#94a3b8;">No businesses yet</td></tr>`;
    } catch (e) {
        console.error(e);
        body.innerHTML = `<tr><td colspan="9" style="color:#ef4444;">Failed: ${companyEscape(e.message || e)}</td></tr>`;
    }
}

function renderCompaniesTable() {
    const body = document.getElementById("companiesBody");
    if (!body) return;

    body.innerHTML = allShopsCache.map((shop, i) => {
        const status = computeSubStatus(shop.license_expiry);
        return `<tr>
            <td>${i + 1}</td>
            <td>${companyEscape(shop.name)}</td>
            <td>${companyEscape(shop.code)}</td>
            <td>${companyEscape(shop.contact_number || "-")}</td>
            <td>${companyEscape(shop.plan_name || "Basic")}</td>
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
    }).join("") || `<tr><td colspan="9" style="text-align:center;color:#94a3b8;">No businesses yet. Click "Add Business" to create one.</td></tr>`;
}

function setShopFieldValue(id, value) {
    const field = document.getElementById(id);
    if (field) field.value = value;
}

function showShopModal() {
    const modal = document.getElementById("shopModal");
    if (!modal) {
        console.error("Business modal element was not found.");
        return;
    }

    RecountixModal.open("shopModal");
    document.body.classList.add("shop-modal-open");
}

function openAddShopModal() {
    const title = document.getElementById("shopModalTitle");
    if (title) title.innerText = "Add Business Shop";

    setShopFieldValue("shopId", "");
    setShopFieldValue("shopName", "");
    setShopFieldValue("shopBusinessType", "Other");
    setShopFieldValue("shopCode", "");
    setShopFieldValue("shopContact", "");
    setShopFieldValue("shopEmail", "");
    setShopFieldValue("shopAddress", "");
    setShopFieldValue("shopPlan", "Basic");
    setShopFieldValue("shopLicenseExpiry", "");
    setShopFieldValue("shopMaxUsers", "5");
    setShopFieldValue("shopAdminUsername", "");
    setShopFieldValue("shopAdminPassword", "");
    setShopFieldValue("shopAdminName", "");

    const adminBlock = document.getElementById("newShopAdminBlock");
    if (adminBlock) adminBlock.style.display = "block";
    const codeField = document.getElementById("shopCode");
    if (codeField) codeField.disabled = false;

    showShopModal();
}

function openEditShopModal(shopId) {
    const shop = allShopsCache.find(s => s.id === shopId);
    if (!shop) return;

    document.getElementById("shopModalTitle").innerText = "Edit Business";
    document.getElementById("shopId").value = shop.id;
    document.getElementById("shopName").value = shop.name || "";
    setShopFieldValue("shopBusinessType", shop.business_type || "Other");
    document.getElementById("shopCode").value = shop.code || "";
    document.getElementById("shopCode").disabled = true;
    document.getElementById("shopContact").value = shop.contact_number || "";
    document.getElementById("shopEmail").value = shop.email || "";
    document.getElementById("shopAddress").value = shop.address || "";
    document.getElementById("shopPlan").value = shop.plan_name || "Basic";
    document.getElementById("shopLicenseExpiry").value = shop.license_expiry || "";
    document.getElementById("shopMaxUsers").value = shop.max_users || 5;
    document.getElementById("newShopAdminBlock").style.display = "none";
    showShopModal();
}

function closeShopModal() {
    const modal = document.getElementById("shopModal");
    if (!modal) return;
    RecountixModal.close("shopModal");
    document.body.classList.remove("shop-modal-open");
}

async function saveShop() {
    const shopId = document.getElementById("shopId").value;
    const form = {
        name: document.getElementById("shopName").value,
        businessType: document.getElementById("shopBusinessType") ? document.getElementById("shopBusinessType").value : "Other",
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
        alert("Business saved successfully.");
    } catch (e) {
        console.error(e);
        alert("Save failed: " + (e.message || e));
    }
}

async function toggleShopActiveHandler(shopId, makeActive) {
    const action = makeActive ? "activate" : "deactivate";
    if (!confirm(`Are you sure you want to ${action} this business? Business Admin login will ${makeActive ? "be restored" : "stop working"}.`)) return;
    try {
        await sbToggleShopActive(shopId, makeActive);
        await loadCompanies();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

async function deleteShopHandler(shopId) {
    if (!confirm("This will permanently delete the business and ALL its customers/recoveries. Continue?")) return;
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
function openRenewShopById(shopId) {
    const shop = allShopsCache.find((item) => String(item.id) === String(shopId));
    if (!shop) return;
    openRenewModal(shop.id, shop.name || "", shop.plan_name || "Basic");
}
window.openRenewShopById = openRenewShopById;

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
                <td>${companyEscape(r.shop.name)}</td>
                <td>${companyEscape((r.subscription && r.subscription.plan_name) || r.shop.plan_name || "Basic")}</td>
                <td>${fmtDate(r.endDate)}</td>
                <td>${dl === null ? "-" : (dl < 0 ? Math.abs(dl) + " days overdue" : dl + " days")}</td>
                <td>${statusBadge(r.liveStatus)}</td>
                <td>${r.shop.is_active
                    ? '<span class="badge badge-success">Active</span>'
                    : '<span class="badge badge-danger">Inactive</span>'}</td>
                <td>
                    <button class="add-btn" style="padding:8px 14px;font-size:13px;" onclick="openRenewShopById('${r.shop.id}')">
                        <i class="fa-solid fa-rotate"></i> Renew
                    </button>
                </td>
            </tr>`;
        }).join("") || `<tr><td colspan="9" style="text-align:center;color:#94a3b8;">No businesses found</td></tr>`;
    } catch (e) {
        console.error(e);
        body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ef4444;">Failed to load: ${companyEscape(e.message || e)}</td></tr>`;
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

    RecountixModal.open("renewModal");
}

function closeRenewModal() {
    RecountixModal.close("renewModal");
}

async function confirmRenewSubscription() {
    const shopId = document.getElementById("renewShopId").value;
    const form = {
        plan: document.getElementById("renewPlan").value,
        amount: document.getElementById("renewAmount").value,
        endDate: document.getElementById("renewEndDate").value,
        remarks: document.getElementById("renewRemarks").value
    };
    if (!form.endDate) {
        alert("Please choose a new expiry date");
        return;
    }
    try {
        await sbRenewSubscription(shopId, form);
        closeRenewModal();
        await loadSubscriptions();
        alert("Subscription renewed successfully.");
    } catch (e) {
        alert("Renewal failed: " + (e.message || e));
    }
}

window.openRenewModal = openRenewModal;
window.closeRenewModal = closeRenewModal;
window.confirmRenewSubscription = confirmRenewSubscription;

/* ================================
   INIT
================================ */
document.addEventListener("DOMContentLoaded", function () {
    const addButton = document.getElementById("addShopButton");
    if (addButton && !addButton.dataset.modalBound) {
        addButton.dataset.modalBound = "true";
        addButton.addEventListener("click", function (event) {
            event.preventDefault();
            openAddShopModal();
        });
    }

    const modal = document.getElementById("shopModal");
    if (modal) {
        modal.addEventListener("click", function (event) {
            if (event.target === modal) closeShopModal();
        });
    }
});

document.addEventListener("keydown", function (event) {
    const modal = document.getElementById("shopModal");
    if (event.key === "Escape" && modal && modal.getAttribute("aria-hidden") === "false") {
        closeShopModal();
    }
});

window.addEventListener("load", async function () {
    // give script.js's checkLogin()/session boot a tick to run first
    setTimeout(async () => {
        if (document.getElementById("shopOverviewBody")) await loadSuperDashboard();
        if (document.getElementById("companiesBody")) await loadCompanies();
        if (document.getElementById("subscriptionBody")) await loadSubscriptions();
    }, 300);
});
