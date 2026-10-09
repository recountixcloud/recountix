/* ==========================================================
   RECOUNTIX
   app.js – Core application logic (customers, recovery, reports, settings)
==========================================================*/

// In-memory cache (loaded from Supabase)
let customers = [];
let recoveries = [];
let settings = {};
let editIndex = -1;
let editCustomerId = null;

// Escape all database/user text before inserting it into HTML templates.
function appEscape(value) {
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

// ================================
// Customer Modal
// ================================
function openModal() {
    if (!rxRequire(editIndex >= 0 ? "modify" : "add")) return;
    const modal = document.getElementById("customerModal");
    if (modal) {
        modal.classList.add("vo-modal-open");
        RecountixModal.open("customerModal");
    }
}

function closeModal() {
    const modal = document.getElementById("customerModal");
    if (modal) {
        modal.classList.remove("vo-modal-open");
        RecountixModal.close("customerModal");
    }
    const form = document.getElementById("customerForm");
    if (form) form.reset();
    const outstanding = document.getElementById("outstanding");
    if (outstanding) outstanding.value = "";
    editIndex = -1;
    editCustomerId = null;
}

window.onclick = function (event) {
    const modal = document.getElementById("customerModal");
    if (modal && event.target === modal) closeModal();
};

// ================================
// Outstanding calc
// ================================
const billInput = document.getElementById("billAmount");
const downInput = document.getElementById("downPayment");
if (billInput && downInput) {
    billInput.addEventListener("input", calculateOutstanding);
    downInput.addEventListener("input", calculateOutstanding);
}

function calculateOutstanding() {
    const bill = parseFloat(document.getElementById("billAmount")?.value) || 0;
    const down = parseFloat(document.getElementById("downPayment")?.value) || 0;
    const original = editIndex >= 0 ? customers[editIndex] : null;
    let outstanding = Math.max(0, original
      ? Number(original.outstanding) + (bill - Number(original.bill)) - (down - Number(original.down))
      : bill - down);
    const outBox = document.getElementById("outstanding");
    if (outBox) outBox.value = outstanding;
}

function validateCustomerForm() {
    const name = document.getElementById("customerName");
    const mobile = document.getElementById("mobile");
    const billAmount = document.getElementById("billAmount");

    if (!name || name.value.trim() === "") {
        alert("Please Enter Customer Name");
        if (name) name.focus();
        return false;
    }
    if (!mobile || mobile.value.trim() === "") {
        alert("Please Enter Mobile Number");
        if (mobile) mobile.focus();
        return false;
    }
    
    // Strict Indian 10-digit mobile number validation
    const cleanedMobile = mobile.value.trim().replace(/\D/g, "");
    const mobileRegex = /^[6-9]\d{9}$/;
    if (!mobileRegex.test(cleanedMobile)) {
        alert("Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.");
        mobile.focus();
        return false;
    }

    if (billAmount && billAmount.value.trim() === "") {
        alert("Please Enter Bill Amount");
        billAmount.focus();
        return false;
    }
    const bill = Number(billAmount?.value || 0);
    const down = Number(document.getElementById("downPayment")?.value || 0);
    if (!Number.isFinite(bill) || !Number.isFinite(down) || bill < 0 || down < 0 || down > bill) {
        alert("Enter valid bill and down payment amounts. Down payment cannot exceed the bill.");
        return false;
    }
    return true;
}

function getCustomerData() {
    return {
        id: editCustomerId || null,
        name: document.getElementById("customerName")?.value || "",
        father: document.getElementById("fatherName")?.value || "",
        mobile: document.getElementById("mobile")?.value || "",
        altMobile: document.getElementById("altMobile")?.value || "",
        village: document.getElementById("village")?.value || "",
        taluka: document.getElementById("taluka")?.value || "",
        district: document.getElementById("district")?.value || "",
        address: document.getElementById("address")?.value || "",
        bill: document.getElementById("billAmount")?.value || 0,
        down: document.getElementById("downPayment")?.value || 0,
        outstanding: document.getElementById("outstanding")?.value || 0,
        executive: document.getElementById("executive")?.value || "",
        followup: document.getElementById("followup")?.value || "",
        remarks: document.getElementById("remarks")?.value || "",
        autoReminder: document.getElementById("autoReminder") ? document.getElementById("autoReminder").checked : true,
        reminderInterval: Number(document.getElementById("reminderInterval")?.value || 3),
        dueDate: (document.getElementById("dueDate")?.value || "").trim(),
        nextReminderDate: document.getElementById("followup")?.value || ""
    };
}

// ================================
// Save Customer
// ================================
async function saveCustomer() {
    if (!rxRequire(editIndex >= 0 ? "modify" : "add")) return;
    if (!validateCustomerForm()) return;

    const customer = getCustomerData();
    if (typeof editCustomerId !== "undefined" && editCustomerId) {
        customer.id = editCustomerId;
    } else if (typeof editIndex !== "undefined" && editIndex >= 0 && customers[editIndex]) {
        customer.id = customers[editIndex].id;
    }
    let finalShopId = currentShopId();
    if (finalShopId) customer.shop_id = finalShopId;

    if (!finalShopId && !isSuperAdmin()) {
        alert("No business assigned. Contact Super Admin.");
        return;
    }

    if (isSuperAdmin() && !finalShopId) {
        alert("Super Admin: login as a Business Admin to manage customers for a specific business.");
        return;
    }

    try {
        await sbSaveCustomer(customer, finalShopId);
        closeModal();
        await reloadAllData();
        alert("Customer Saved Successfully.");
    } catch (e) {
        console.error(e);
        alert("Save failed: " + (e.message || e));
    }
}

function clearCustomerForm() {
    const form = document.getElementById("customerForm");
    if (form) form.reset();
    const outstanding = document.getElementById("outstanding");
    if (outstanding) outstanding.value = "";
    editIndex = -1;
    editCustomerId = null;
}

// ================================
// Load Customers & Aging
// ================================
function getCustomerDaysOverdue(c) {
    if (!c || Number(c.outstanding || 0) <= 0) return null;
    const due = (c.dueDate || c.followup || "").toString().slice(0, 10);
    if (!due) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(due);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return Math.floor((today - d) / 86400000);
}

function getCustomerAgingBucket(c) {
    const diff = getCustomerDaysOverdue(c);
    if (diff === null) {
        if (c.agingBucket && c.agingBucket !== "none") return c.agingBucket;
        return "none";
    }
    if (diff <= 0) return "current";
    if (diff <= 30) return "0-30";
    if (diff <= 60) return "31-60";
    if (diff <= 90) return "61-90";
    return "90+";
}

function agingBadgeHtml(bucket, days) {
    const map = {
        "0-30": { bg: "#e0f2fe", color: "#075985", label: "0–30" },
        "31-60": { bg: "#fef3c7", color: "#92400e", label: "31–60" },
        "61-90": { bg: "#ffedd5", color: "#9a3412", label: "61–90" },
        "90+": { bg: "#fee2e2", color: "#991b1b", label: "90+" },
        "current": { bg: "#dcfce7", color: "#166534", label: "Current" },
        "none": { bg: "#f1f5f9", color: "#64748b", label: "—" }
    };
    const m = map[bucket] || map.none;
    let label = m.label;
    if (typeof days === "number") {
        if (days > 0) label = days + "d · " + m.label;
        else if (days === 0) label = "Due today";
        else label = Math.abs(days) + "d left";
    }
    return `<span class="badge" style="background:${m.bg};color:${m.color};white-space:nowrap;">${appEscape(label)}</span>`;
}

function buildClientAgingSummary(list) {
    const s = {
        total_customers: 0,
        total_outstanding: 0,
        bucket_0_30: 0,
        bucket_31_60: 0,
        bucket_61_90: 0,
        bucket_90_plus: 0,
        total_overdue: 0,
        open_ptp: 0,
        open_escalations: 0,
        count_0_30: 0,
        count_31_60: 0,
        count_61_90: 0,
        count_90: 0,
        count_current: 0,
        rows: []
    };
    (list || []).forEach(c => {
        const out = Number(c.outstanding || 0);
        if (out <= 0) return;
        s.total_customers++;
        s.total_outstanding += out;
        const days = getCustomerDaysOverdue(c);
        const bucket = getCustomerAgingBucket(c);
        if (days !== null && days > 0) {
            s.total_overdue += out;
            if (bucket === "0-30") { s.bucket_0_30 += out; s.count_0_30++; }
            else if (bucket === "31-60") { s.bucket_31_60 += out; s.count_31_60++; }
            else if (bucket === "61-90") { s.bucket_61_90 += out; s.count_61_90++; }
            else if (bucket === "90+") { s.bucket_90_plus += out; s.count_90++; }
            s.rows.push({
                name: c.name,
                outstanding: out,
                days: days,
                bucket: bucket,
                due: (c.dueDate || c.followup || "").toString().slice(0, 10)
            });
        } else if (bucket === "current") {
            s.count_current++;
        }
    });
    s.rows.sort((a, b) => b.days - a.days);
    return s;
}

let customerAgingFilter = "all";

function setCustomerAgingFilter(bucket) {
    customerAgingFilter = bucket || "all";
    const label = document.getElementById("agingFilterLabel");
    if (label) {
        label.textContent = bucket && bucket !== "all" ? ("Showing: " + bucket) : "";
    }
    try {
        if (bucket && bucket !== "all") {
            const hashMap = { "0-30": "aging_0_30", "31-60": "aging_31_60", "61-90": "aging_61_90", "90+": "aging_90" };
            history.replaceState(null, "", "#" + (hashMap[bucket] || bucket));
        } else {
            history.replaceState(null, "", window.location.pathname + window.location.search);
        }
    } catch (e) {}
    loadCustomers();
}

function applyHashAgingFilter() {
    const h = (window.location.hash || "").replace(/^#/, "");
    const map = {
        aging_0_30: "0-30",
        aging_31_60: "31-60",
        aging_61_90: "61-90",
        aging_90: "90+",
        "0-30": "0-30",
        "31-60": "31-60",
        "61-90": "61-90",
        "90+": "90+"
    };
    if (map[h]) setCustomerAgingFilter(map[h]);
}

function loadCustomers() {
    const tbody = document.getElementById("customerBody");
    if (!tbody) return;

    tbody.innerHTML = "";
    let rowNum = 0;
    customers.forEach((customer, index) => {
        const bucket = getCustomerAgingBucket(customer);
        if (customerAgingFilter && customerAgingFilter !== "all") {
            if (bucket !== customerAgingFilter) return;
        }

        rowNum++;
        const deleteButton = rxCan("delete")
            ? `<button onclick="deleteCustomer(${index})" title="Delete">🗑️</button>`
            : "";
        const hasMobile = !!(customer.mobile && String(customer.mobile).replace(/\D/g, "").length >= 10);
        const waBtn = hasMobile
            ? `<button type="button" onclick="sendWhatsAppReminder(${index})" title="WhatsApp Due Reminder"
                style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:#fff;border:none;border-radius:16px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;margin:2px;box-shadow:0 2px 8px rgba(37,211,102,.4);">
                💬 WA Due
               </button>`
            : `<button type="button" disabled title="Mobile number required"
                style="display:inline-flex;background:#94a3b8;color:#fff;border:none;border-radius:16px;padding:6px 10px;font-size:11px;margin:2px;opacity:.7;">
                💬 No Mob
               </button>`;

        const dueShow = (customer.dueDate || customer.followup || "").toString().slice(0, 10);

        tbody.innerHTML += `
        <tr>
            <td>${rowNum}</td>
            <td>${appEscape(customer.name)}</td>
            <td>${appEscape(customer.mobile || "-")}</td>
            <td>${appEscape(customer.village || "")}</td>
            <td>₹${Number(customer.outstanding || 0).toLocaleString("en-IN")}</td>
            <td>${agingBadgeHtml(bucket, getCustomerDaysOverdue(customer))}</td>
            <td>${appEscape(dueShow)}${customer.autoReminder === false ? " 🔕" : ""}</td>
            <td style="white-space:nowrap;">
                <button onclick="viewCustomer(${index})" title="View">👁</button>
                <button onclick="editCustomer(${index})" title="Edit">✏️</button>
                ${waBtn}
                <button type="button" onclick="setCustomerPortalPin(${index})" title="Set Customer Portal PIN" style="display:inline-flex;align-items:center;gap:4px;background:#0B5D4F;color:#fff;border:none;border-radius:16px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;margin:2px;">🔐 PIN</button>
                <button type="button" onclick="openPaymentLinkForCustomer(${index})" title="UPI / Payment link"
                  style="display:inline-flex;align-items:center;gap:4px;background:#1A3D63;color:#fff;border:none;border-radius:16px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;margin:2px;">₹ Pay</button>
                <button type="button" onclick="openLegalNoticeForCustomer(${index})" title="Legal / reminder letter"
                  style="display:inline-flex;align-items:center;gap:4px;background:#7c3aed;color:#fff;border:none;border-radius:16px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;margin:2px;">📜 Notice</button>
                ${deleteButton}
            </td>
        </tr>`;
    });

    if (rowNum === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#73879B;">No customers in this filter</td></tr>`;
    }
}

window.getCustomerAgingBucket = getCustomerAgingBucket;
window.agingBadgeHtml = agingBadgeHtml;
window.setCustomerAgingFilter = setCustomerAgingFilter;
window.applyHashAgingFilter = applyHashAgingFilter;

// ================================
// Edit / Delete / Search / View
// ================================
function editCustomer(index) {
    if (!rxRequire("modify")) return;
    editIndex = index;
    const c = customers[index];
    editCustomerId = c.id;

    document.getElementById("customerName").value = c.name || "";
    const pn = document.getElementById("productName"); if (pn) pn.value = c.productName || "";
    document.getElementById("fatherName").value = c.father || "";
    document.getElementById("mobile").value = c.mobile || "";
    document.getElementById("altMobile").value = c.altMobile || "";
    document.getElementById("village").value = c.village || "";
    document.getElementById("taluka").value = c.taluka || "";
    document.getElementById("district").value = c.district || "";
    document.getElementById("address").value = c.address || "";
    document.getElementById("billAmount").value = c.bill || 0;
    document.getElementById("downPayment").value = c.down || 0;
    document.getElementById("outstanding").value = c.outstanding || 0;
    document.getElementById("executive").value = c.executive || "";
    document.getElementById("followup").value = c.followup || "";
    const dueEl = document.getElementById("dueDate"); if (dueEl) dueEl.value = (c.dueDate || c.followup || "").toString().slice(0,10);
    document.getElementById("remarks").value = c.remarks || "";

    openModal();
}

async function setCustomerPortalPin(index) {
    if (!rxRequire("modify")) return;
    const customer = customers[index];
    if (!customer || !customer.id) {
        alert("Customer not found.");
        return;
    }
    const pin = prompt("Set customer portal PIN for " + (customer.name || "this customer") + " (minimum 4 characters):");
    if (pin === null) return;
    if (String(pin).trim().length < 4) {
        alert("PIN must be at least 4 characters.");
        return;
    }
    const confirmPin = prompt("Confirm portal PIN:");
    if (confirmPin === null) return;
    if (pin !== confirmPin) {
        alert("PIN does not match.");
        return;
    }
    try {
        await sbSetCustomerPortalPin(customer.id, pin.trim());
        alert("Portal PIN saved. Share Business Code + Mobile + PIN with the customer.");
    } catch (e) {
        console.error(e);
        alert("PIN save failed: " + (e.message || e));
    }
}

async function deleteCustomer(index) {
    if (!rxCan("delete")) {
        alert("Your Administrator has not granted Delete permission.");
        return;
    }
    if (!confirm("Delete this customer permanently?")) return;

    const removed = customers[index];
    try {
        await sbDeleteCustomer(removed.id);
        await reloadAllData();
    } catch (e) {
        console.error(e);
        alert("Delete failed: " + (e.message || e));
    }
}

function searchCustomer() {
    const keyword = (document.getElementById("searchCustomer")?.value || "").toLowerCase();
    const rows = document.querySelectorAll("#customerBody tr");
    rows.forEach(row => {
        row.style.display = row.innerText.toLowerCase().includes(keyword) ? "" : "none";
    });
}

function viewCustomer(index) {
    const c = customers[index];
    const msg =
`Customer Details

Customer : ${c.name}
Father : ${c.father}
Mobile : ${c.mobile}
Alternate : ${c.altMobile}
Village : ${c.village}
Taluka : ${c.taluka}
District : ${c.district}
Address :
${c.address}
Bill Amount : ₹${c.bill}
Down Payment : ₹${c.down}
Outstanding : ₹${c.outstanding}
Executive : ${c.executive}
Follow-up : ${c.followup}
Remarks :
${c.remarks}
`;
    if (Number(c.outstanding || 0) > 0 && c.mobile) {
        if (confirm(msg + "\n\nSend WhatsApp dues reminder?")) {
            sendWhatsAppReminder(index);
        }
    } else {
        alert(msg);
    }
}

// ================================
// WhatsApp Dues Reminder
// ================================
function normalizeWhatsAppNumber(mobile) {
    let n = String(mobile || "").replace(/\D/g, "");
    if (!n) return "";
    if (n.length === 10) n = "91" + n;
    if (n.startsWith("0") && n.length === 11) n = "91" + n.slice(1);
    return n;
}

function buildWhatsAppReminderMessage(customer) {
    const session = (typeof getSession === "function") ? getSession() : {};
    const shopName = (session.shopName)
        || (typeof settings !== "undefined" && settings.company)
        || "Business";
    const name = customer.name || "Customer";
    const outstanding = Number(customer.outstanding || 0).toLocaleString("en-IN");
    const bill = Number(customer.bill || 0).toLocaleString("en-IN");
    const phone = (typeof settings !== "undefined" && settings.phone) ? settings.phone : "";
    const lines = [
        "🙏 Namaste " + name + " ji,",
        "",
        "*" + shopName + "* – Payment Reminder",
        "",
        "Your account has *outstanding dues* pending.",
        "",
        "📋 Bill Amount: ₹" + bill,
        "💰 *Pending Dues: ₹" + outstanding + "*",
        "",
        "Please make payment soon to clear your account.",
        "After payment, contact the business for receipt or account update.",
        phone ? ("📞 " + phone) : "",
        "",
        "Thank you,",
        shopName,
        "_Powered by Recountix_"
    ].filter(Boolean);
    return lines.join("\n");
}

function sendWhatsAppReminder(index) {
    const customer = (typeof customers !== "undefined") ? customers[index] : null;
    if (!customer) {
        alert("Customer not found");
        return;
    }
    const phone = normalizeWhatsAppNumber(customer.mobile);
    if (!phone || phone.length < 12) {
        alert("Valid mobile number not found. Enter a 10-digit mobile on the customer.");
        return;
    }
    const amt = Number(customer.outstanding || 0);
    if (amt <= 0) {
        if (!confirm("Outstanding is ₹0. Still send reminder?")) return;
    }
    const text = buildWhatsAppReminderMessage(customer);
    const url = "https://wa.me/" + phone + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank", "noopener,noreferrer");
}

window.sendWhatsAppReminder = sendWhatsAppReminder;
window.normalizeWhatsAppNumber = normalizeWhatsAppNumber;
window.buildWhatsAppReminderMessage = buildWhatsAppReminderMessage;

function addDaysISO(dateStr, days) {
    const d = new Date(dateStr || new Date());
    if (isNaN(d.getTime())) return todayISO();
    d.setDate(d.getDate() + Number(days || 3));
    return d.toISOString().split("T")[0];
}

function getDueReminderCustomers() {
    const today = (typeof todayISO === "function") ? todayISO() : new Date().toISOString().split("T")[0];
    return (customers || []).filter(c => {
        if (c.autoReminder === false) return false;
        if (Number(c.outstanding || 0) <= 0) return false;
        if (!c.mobile) return false;
        const due = c.dueDate || c.followup || c.nextReminderDate;
        if (!due) return false;
        if (due > today && (!c.nextReminderDate || c.nextReminderDate > today)) {
            if (c.nextReminderDate && c.nextReminderDate <= today) return true;
            return false;
        }
        if (due <= today) {
            if (!c.nextReminderDate || c.nextReminderDate <= today) return true;
        }
        return false;
    });
}

async function processWhatsAppReminders(autoOpen) {
    if (!rxRequire("modify")) return;
    const list = getDueReminderCustomers();
    if (!list.length) {
        alert("No auto-reminders pending today.\n\n• Outstanding > 0\n• Auto Reminder ON\n• Follow-up / Due date today or past");
        return;
    }
    if (!confirm(list.length + " customer(s) — send WhatsApp due reminder?\n\nOK = WhatsApp will open one by one.")) return;

    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const idx = customers.findIndex(x => x.id === c.id);
        if (idx < 0) continue;
        sendWhatsAppReminder(idx);
        const interval = Number(c.reminderInterval || 3);
        const next = addDaysISO(new Date().toISOString().split("T")[0], interval);
        try {
            if (typeof sbMarkReminderSent === "function") {
                await sbMarkReminderSent(c.id, next);
            }
            c.lastReminderAt = new Date().toISOString();
            c.nextReminderDate = next;
        } catch (e) {
            console.error(e);
        }
        if (i < list.length - 1) {
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    alert("Reminders processed. Next auto date: +" + (list[0].reminderInterval || 3) + " days.");
    if (typeof reloadAllData === "function") await reloadAllData();
}

window.getDueReminderCustomers = getDueReminderCustomers;
window.processWhatsAppReminders = processWhatsAppReminders;
window.addDaysISO = addDaysISO;

// ================================
// Dashboard
// ================================
function updateDashboard() {
    const totalCustomers = document.getElementById("totalCustomers");
    const totalOutstanding = document.getElementById("totalOutstanding");
    const todayFollowup = document.getElementById("todayFollowup");
    const todayRecovery = document.getElementById("todayRecovery");

    if (!totalCustomers) return;

    totalCustomers.innerHTML = customers.length;

    let outstanding = 0;
    customers.forEach(c => { outstanding += Number(c.outstanding || 0); });
    if (totalOutstanding) {
        totalOutstanding.innerHTML = "₹" + outstanding.toLocaleString("en-IN");
    }

    const today = new Date().toISOString().split("T")[0];
    const followCount = customers.filter(c => c.followup === today).length;
    if (todayFollowup) todayFollowup.innerHTML = followCount;

    let recoveryTotal = 0;
    recoveries.forEach(item => {
        if (item.date === today) recoveryTotal += Number(item.amount || 0);
    });
    if (todayRecovery) {
        todayRecovery.innerHTML = "₹" + recoveryTotal.toLocaleString("en-IN");
    }

    if (typeof renderDashboardCharts === "function") renderDashboardCharts();

    if (typeof loadAgingDashboard === "function") {
        loadAgingDashboard().catch(function (e) { console.warn("aging", e); });
    }
}

let dashboardRecoveryChart = null;
let dashboardPortfolioChart = null;
function renderDashboardCharts() {
    if (typeof Chart === "undefined") return;
    const trendCanvas = document.getElementById("recoveryTrendChart");
    const portfolioCanvas = document.getElementById("portfolioStatusChart");
    if (!trendCanvas || !portfolioCanvas) return;
    const recoveryMap = {};
    (recoveries || []).forEach(function(r){
        const key = String(r.date || "").slice(0, 10);
        if (!key) return;
        recoveryMap[key] = (recoveryMap[key] || 0) + Number(r.amount || 0);
    });
    const trendRows = [];
    const trendToday = new Date();
    trendToday.setHours(0, 0, 0, 0);
    for (let offset = 29; offset >= 0; offset--) {
        const d = new Date(trendToday);
        d.setDate(trendToday.getDate() - offset);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        trendRows.push({ key: `${yyyy}-${mm}-${dd}`, date: d });
    }
    const labels = trendRows.map(function(row){
        return row.date.toLocaleDateString("en-IN", {day:"2-digit", month:"short"});
    });
    const values = trendRows.map(function(row){ return recoveryMap[row.key] || 0; });
    if (dashboardRecoveryChart) dashboardRecoveryChart.destroy();
    dashboardRecoveryChart = new Chart(trendCanvas, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Recovery",
                data: values,
                borderColor: "#0B6B59",
                backgroundColor: "#0B6B59",
                borderWidth: 2.5,
                tension: .42,
                fill: false,
                pointRadius: values.length === 1 ? 4 : 2.5,
                pointHoverRadius: 5,
                pointBackgroundColor: "#ffffff",
                pointBorderColor: "#0B6B59",
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: "index" },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    backgroundColor: "#10251f",
                    titleColor: "#d9eee7",
                    bodyColor: "#ffffff",
                    padding: 10,
                    cornerRadius: 10,
                    callbacks: {
                        label: function(ctx) { return "Recovery  ₹" + Number(ctx.raw||0).toLocaleString("en-IN"); }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    ticks: {
                        color: "#7a8984",
                        padding: 8,
                        callback: function(v) { return "₹" + Number(v).toLocaleString("en-IN", {notation: "compact", maximumFractionDigits: 1}); }
                    },
                    grid: { color: "rgba(15,107,79,.08)", drawTicks: false }
                },
                x: { border: { display: false }, ticks: { color: "#7a8984", padding: 8 }, grid: { display: false } }
            }
        }
    });

    const today = new Date().toISOString().split("T")[0];
    const total = (customers || []).length;
    const follow = (customers || []).filter(function(c){ return c.followup === today; }).length;
    const escalated = (customers || []).filter(function(c){ return String(c.status||"").toLowerCase().includes("escalat"); }).length;
    const stable = Math.max(total - follow - escalated, 0);
    if (dashboardPortfolioChart) dashboardPortfolioChart.destroy();
    dashboardPortfolioChart = new Chart(portfolioCanvas, {
        type: "doughnut",
        data: {
            labels: ["Stable", "Follow-up today", "Escalated"],
            datasets: [{ data: [stable, follow, escalated], borderWidth: 0, hoverOffset: 5 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "68%",
            plugins: {
                legend: { position: "bottom", labels: { boxWidth: 9, usePointStyle: true, padding: 16 } },
                tooltip: { callbacks: { label: function(ctx) { return " " + ctx.label + ": " + ctx.raw + " accounts"; } } }
            }
        }
    });
}
window.renderDashboardCharts = renderDashboardCharts;

function loadRecentCustomers() {
    const tbody = document.getElementById("recentCustomers");
    if (!tbody) return;
    tbody.innerHTML = "";
    customers.slice(0, 5).forEach((customer, index) => {
        tbody.innerHTML += `
        <tr>
            <td>${index + 1}</td>
            <td>${appEscape(customer.name)}</td>
            <td>${appEscape(customer.mobile)}</td>
            <td>${appEscape(customer.village)}</td>
            <td>₹${Number(customer.outstanding || 0).toLocaleString("en-IN")}</td>
            <td><span class="badge badge-success">Active</span></td>
        </tr>`;
    });
}

function loadDashboardFollowups() {
    const tbody = document.getElementById("followupTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    const today = new Date().toISOString().split("T")[0];
    customers.filter(c => c.followup === today).forEach((customer, index) => {
        tbody.innerHTML += `
        <tr>
            <td>${index + 1}</td>
            <td>${appEscape(customer.name)}</td>
            <td>${appEscape(customer.mobile)}</td>
            <td>${appEscape(customer.village)}</td>
            <td>₹${Number(customer.outstanding || 0).toLocaleString("en-IN")}</td>
            <td>${appEscape(customer.followup)}</td>
        </tr>`;
    });
}

function loadDashboardRecentRecovery() {
    const tbody = document.getElementById("recoveryTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    recoveries.slice(0, 5).forEach((item, index) => {
        const customer = (customers || []).find(c => String(c.id) === String(item.customerId));
        tbody.innerHTML += `
        <tr>
            <td>${index + 1}</td>
            <td>${appEscape(customer ? customer.name : "-")}</td>
            <td>₹${Number(item.amount || 0).toLocaleString("en-IN")}</td>
            <td>${appEscape(item.date)}</td>
            <td>${appEscape(item.remarks || "-")}</td>
        </tr>`;
    });
}

// ================================
// Recovery Module
// ================================
async function saveRecovery() {
    if (!rxRequire("add")) return;
    if (saveRecovery.__saving) return;
    const customerId = document.getElementById("recoveryCustomer");
    const amount = document.getElementById("recoveryAmount");
    const date = document.getElementById("recoveryDate");
    const remarks = document.getElementById("recoveryRemarks");
    const paymentMode = document.getElementById("paymentMode");
    const receiptNo = document.getElementById("receiptNo");
    const collectedBy = document.getElementById("collectedBy");

    if (!customerId || !amount || !date) return;
    if (customerId.value === "") { alert("Please Select Customer"); return; }
    
    const custCheck = (customers || []).find(c => String(c.id) === String(customerId.value));
    const payAmt = Number(amount.value || 0);
    const dueAmt = custCheck ? Number(custCheck.outstanding || 0) : 0;
    const remarkText = remarks ? (remarks.value || "").trim() : "";

    if (payAmt < 0) {
        alert("Recovery amount cannot be negative.");
        return;
    }
    if (payAmt === 0 && !remarkText) {
        alert("Amount is 0 (call / no payment).\n\nPlease enter details in Remarks\n(e.g. Called customer – payment not received).");
        if (remarks) remarks.focus();
        return;
    }
    if (custCheck && payAmt > dueAmt + 0.001) {
        alert("❌ Recovery entry not allowed\n\nCustomer: " + (custCheck.name || "-") + "\nCurrent Outstanding: ₹" + dueAmt.toLocaleString("en-IN") + "\nYou entered: ₹" + payAmt.toLocaleString("en-IN") + "\nExtra: ₹" + (payAmt - dueAmt).toLocaleString("en-IN") + "\n\nAmount cannot exceed outstanding balance.\nPlease enter ₹" + dueAmt.toLocaleString("en-IN") + " or less.");
        amount.focus();
        return;
    }

    let finalShopId = currentShopId();
    const cust = (customers || []).find(c => String(c.id) === String(customerId.value));
    if (isSuperAdmin() && cust) finalShopId = cust.shop_id;

    if (!finalShopId) {
        alert("No business context.");
        return;
    }

    const recovery = {
        customerId: customerId.value,
        amount: Number(amount.value),
        date: date.value,
        paymentMode: paymentMode ? paymentMode.value : "Cash",
        receiptNo: receiptNo ? receiptNo.value : "",
        collectedBy: collectedBy ? collectedBy.value : "",
        remarks: remarks ? remarks.value : "",
        requestKey: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2)
    };

    try {
        saveRecovery.__saving = true;
        const savedRecovery = await sbSaveRecovery(recovery, finalShopId);

        const paidAmt = Number(amount.value || 0);
        const newOutForReceipt = cust ? Math.max(0, Number(cust.outstanding || 0) - paidAmt) : 0;
        const receiptSnapshot = {
            amount: paidAmt,
            date: date.value,
            paymentMode: paymentMode ? paymentMode.value : "",
            receiptNo: receiptNo ? receiptNo.value : "",
            remarks: remarks ? remarks.value : "",
            id: savedRecovery && savedRecovery.id ? savedRecovery.id : null
        };

        amount.value = "";
        if (remarks) remarks.value = "";
        if (receiptNo) receiptNo.value = "";
        if (paymentMode) paymentMode.selectedIndex = 0;
        if (collectedBy) collectedBy.selectedIndex = 0;
        customerId.value = "";
        const outBox = document.getElementById("recoveryOutstanding");
        if (outBox) outBox.value = "";

        await reloadAllData();
        alert("Recovery Saved Successfully.");
        if (paidAmt > 0 && typeof afterRecoveryReceipt === "function") {
            try { await afterRecoveryReceipt(receiptSnapshot, cust, newOutForReceipt); } catch (re) { console.warn(re); }
        }
    } catch (e) {
        console.error(e);
        alert("Save failed: " + (e.message || e));
    } finally {
        saveRecovery.__saving = false;
    }
}

function searchRecovery() {
    const query = (document.getElementById("searchRecovery")?.value || "").trim().toLowerCase();
    document.querySelectorAll("#recoveryBody tr").forEach(row => {
      row.hidden = query !== "" && !row.textContent.toLowerCase().includes(query);
    });
}
window.searchRecovery = searchRecovery;

function loadRecoveryTable() {
    const tbody = document.getElementById("recoveryBody");
    if (!tbody) return;

    tbody.innerHTML = "";
    recoveries.forEach((item, index) => {
        const customer = (customers || []).find(c => String(c.id) === String(item.customerId));
        const deleteBtn = rxCan("delete")
            ? `<button class="action-btn delete-btn" onclick="deleteRecovery(${index})" title="Delete">🗑️</button>`
            : "";

        tbody.innerHTML += `
        <tr>
            <td>${index + 1}</td>
            <td>${appEscape(customer ? customer.name : "-")}</td>
            <td>₹${Number(item.amount || 0).toLocaleString("en-IN")}</td>
            <td>${appEscape(item.paymentMode || "-")}</td>
            <td>${appEscape(item.receiptNo || "-")}</td>
            <td>${appEscape(item.date || "-")}</td>
            <td>${appEscape(item.collectedBy || "-")}</td>
            <td>${appEscape(item.remarks || "-")}</td>
            <td>
                ${Number(item.amount || 0) > 0 ? `<button type="button" onclick="printRecoveryFromTable(${index})" title="Print receipt">🧾</button>` : ""}
                ${Number(item.amount || 0) > 0 ? `<button type="button" onclick="sendRecoveryReceiptWhatsApp(${index})" title="WhatsApp receipt">WA</button>` : ""}
                ${rxCan("modify") ? `<button type="button" onclick="editRecovery(${index})" title="Modify">✏️</button>` : ""}
                ${deleteBtn}
            </td>
        </tr>`;
    });
    searchRecovery();
}

async function deleteRecovery(index) {
    if (!rxCan("delete")) {
        alert("Your Administrator has not granted Delete permission.");
        return;
    }
    if (!confirm("Delete this recovery entry?")) return;

    const item = recoveries[index];
    try {
        await sbDeleteRecovery(item.id);
        await reloadAllData();
    } catch (e) {
        console.error(e);
        alert("Delete failed: " + (e.message || e));
    }
}

function loadRecoveryCustomers() {
    const select = document.getElementById("recoveryCustomer");
    if (!select) return;
    const prev = select.value;
    select.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select Customer";
    select.appendChild(opt0);

    (customers || []).forEach(function(customer) {
        const out = Number(customer.outstanding || 0);
        const opt = document.createElement("option");
        opt.value = String(customer.id);
        opt.setAttribute("data-outstanding", String(out));
        opt.textContent = customer.name + (out > 0 ? (" — ₹" + out.toLocaleString("en-IN") + " due") : " — Paid");
        select.appendChild(opt);
    });

    if (prev) select.value = prev;

    select.onchange = onRecoveryCustomerChange;
    select.addEventListener("change", onRecoveryCustomerChange);
    select.addEventListener("input", onRecoveryCustomerChange);

    onRecoveryCustomerChange();
}

function onRecoveryCustomerChange() {
    try {
        const select = document.getElementById("recoveryCustomer");
        const outBox = document.getElementById("recoveryOutstanding");
        const amtBox = document.getElementById("recoveryAmount");
        const hint = document.getElementById("recoveryOutHint");
        if (!select || !outBox) return;

        const val = select.value;
        if (!val) {
            outBox.value = "";
            if (hint) {
                hint.textContent = "Select a customer to see pending amount";
                hint.style.color = "#73879B";
            }
            return;
        }

        let out = 0;
        const selected = select.options[select.selectedIndex];
        if (selected && selected.getAttribute("data-outstanding") != null) {
            out = Number(selected.getAttribute("data-outstanding") || 0);
        }

        const c = (customers || []).find(function(x) {
            return String(x.id) === String(val) || String(x.id) === val;
        });
        if (c) out = Number(c.outstanding || 0);

