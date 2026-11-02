/* ==========================================================
   RECOUNTIX - Super Admin Pages
   super-dashboard.html / companies.html / subscription.html
========================================================== */

function companyEscape(value) {
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

function fmtDate(d) {
    if (!d) return "-";
    const dt = new Date(d);
    if (isNaN(dt)) return "-";
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function statusBadge(status) {
    if (status === "active") return '<span class="badge badge-success">Active</span>';
    if (status === "expiring") return '<span class="badge badge-warning">Expiring Soon</span>';
    return '<span class="badge badge-danger">Expired</span>';
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
                <button type="button" onclick="openEditShopModal('${companyEscape(shop.id)}')" title="Edit">✏️</button>
                <button type="button" onclick="toggleShopActiveHandler('${companyEscape(shop.id)}', ${shop.is_active ? 'false' : 'true'})" title="Toggle">⏸️</button>
                <button type="button" onclick="deleteShopHandler('${companyEscape(shop.id)}')" title="Delete">🗑️</button>
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
                <button class="btn-reset" style="border-radius:6px;padding:6px 10px;" onclick="openEditShopModal('${companyEscape(shop.id)}')">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-reset" style="border-radius:6px;padding:6px 10px;background:${shop.is_active ? "#f59e0b" : "#16a34a"};"
                    onclick="toggleShopActiveHandler('${companyEscape(shop.id)}', ${!shop.is_active})">
                    <i class="fa-solid ${shop.is_active ? "fa-ban" : "fa-check"}"></i>
                </button>
                <button class="btn-reset" style="border-radius:6px;padding:6px 10px;background:#ef4444;" onclick="deleteShopHandler('${companyEscape(shop.id)}')">
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
    const shop = allShopsCache.find(s => String(s.id) === String(shopId));
    if (!shop) {
        console.warn("Cannot edit business: the selected business is no longer in the loaded list.", shopId);
        alert("Business not found. Please refresh the list and try again.");
        return;
    }

    const requiredFields = ["shopModalTitle", "shopId", "shopName", "shopCode", "shopContact", "shopEmail", "shopAddress", "shopPlan", "shopLicenseExpiry", "shopMaxUsers"];
    const missing = requiredFields.filter(id => !document.getElementById(id));
    if (missing.length) {
        console.error("Business edit form is incomplete:", missing);
        alert("Business edit form could not open. Missing fields: " + missing.join(", "));
        return;
    }

    document.getElementById("shopModalTitle").textContent = "Edit Business";
    setShopFieldValue("shopId", shop.id || "");
    setShopFieldValue("shopName", shop.name || "");
    setShopFieldValue("shopBusinessType", shop.business_type || "Other");
    setShopFieldValue("shopCode", shop.code || "");
    document.getElementById("shopCode").disabled = true;
    setShopFieldValue("shopContact", shop.contact_number || "");
    setShopFieldValue("shopEmail", shop.email || "");
    setShopFieldValue("shopAddress", shop.address || "");
    setShopFieldValue("shopPlan", shop.plan_name || "Basic");
    setShopFieldValue("shopLicenseExpiry", String(shop.license_expiry || "").slice(0, 10));
    setShopFieldValue("shopMaxUsers", shop.max_users || 5);
    const adminBlock = document.getElementById("newShopAdminBlock");
    if (adminBlock) adminBlock.style.display = "none";
    showShopModal();
}

function closeShopModal() {
    const modal = document.getElementById("shopModal");
    if (!modal) return;
    RecountixModal.close("shopModal");
    document.body.classList.remove("shop-modal-open");
}

async function saveShop() {
    const shopId = document.getElementById("shopId").value.trim();
    const form = {
        name: document.getElementById("shopName").value.trim(),
        businessType: document.getElementById("shopBusinessType") ? document.getElementById("shopBusinessType").value : "Other",
        code: document.getElementById("shopCode").value.trim(),
        contact: document.getElementById("shopContact").value.trim(),
        email: document.getElementById("shopEmail").value.trim(),
        address: document.getElementById("shopAddress").value.trim(),
        plan: document.getElementById("shopPlan").value,
        licenseExpiry: document.getElementById("shopLicenseExpiry").value,
        maxUsers: document.getElementById("shopMaxUsers").value,
        adminUsername: document.getElementById("shopAdminUsername") ? document.getElementById("shopAdminUsername").value.trim() : "",
        adminPassword: document.getElementById("shopAdminPassword") ? document.getElementById("shopAdminPassword").value.trim() : "",
        adminName: document.getElementById("shopAdminName") ? document.getElementById("shopAdminName").value.trim() : ""
    };

    if (!form.name) {
        alert("Please enter business name");
        return;
    }
    if (!shopId && !form.code) {
        alert("Please enter business code");
        return;
    }

    const saveButton = document.querySelector("#shopModal button[onclick*=\"saveShop\"]");
    if (saveButton && saveButton.disabled) return;
    if (saveButton) { saveButton.disabled = true; saveButton.dataset.originalText = saveButton.textContent; saveButton.textContent = "Saving…"; }
    try {
        if (shopId) {
            await sbUpdateShop(shopId, form);
        } else {
            await sbAddShop(form);
        }
        await loadCompanies();
        closeShopModal();
        alert("Business saved successfully.");
    } catch (e) {
        console.error("Business save failed:", e);
        alert("Save failed: " + (e && e.message ? e.message : String(e)));
    } finally {
        if (saveButton) { saveButton.disabled = false; if (saveButton.dataset.originalText) saveButton.textContent = saveButton.dataset.originalText; }
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

/* Initialize only the retained Company Management page. */
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
    if (modal) modal.addEventListener("click", event => { if (event.target === modal) closeShopModal(); });
});
document.addEventListener("keydown", function (event) {
    const modal = document.getElementById("shopModal");
    if (event.key === "Escape" && modal && modal.getAttribute("aria-hidden") === "false") closeShopModal();
});
window.addEventListener("load", function () {
    if (document.getElementById("companiesBody")) loadCompanies();
});
