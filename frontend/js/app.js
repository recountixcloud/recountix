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

// ================================
// Login
// ================================




// ================================
// Super Admin sidebar links
// (injected on every page when role === super_admin)
// ================================






// ================================
// Customer Modal
// ================================
function openModal() {
    const modal = document.getElementById("customerModal");
    if (modal) {
        modal.classList.add("vo-modal-open");
        modal.style.display = "flex";
    }
}

function closeModal() {
    const modal = document.getElementById("customerModal");
    if (modal) {
        modal.classList.remove("vo-modal-open");
        modal.style.display = "none";
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
    let outstanding = Math.max(0, bill - down);
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
    if (mobile.value.trim().length < 10) {
        alert("Mobile Number Must Be 10 Digits");
        mobile.focus();
        return false;
    }
    if (billAmount && billAmount.value.trim() === "") {
        alert("Please Enter Bill Amount");
        billAmount.focus();
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
    if (!validateCustomerForm()) return;

    const customer = getCustomerData();
    // Ensure update path has id (edit mode)
    if (typeof editCustomerId !== "undefined" && editCustomerId) {
        customer.id = editCustomerId;
    } else if (typeof editIndex !== "undefined" && editIndex >= 0 && customers[editIndex]) {
        customer.id = customers[editIndex].id;
    }
    let finalShopId = currentShopId();
    if (finalShopId) customer.shop_id = finalShopId;

    if (!finalShopId && !isSuperAdmin()) {
        alert("No shop assigned. Contact Super Admin.");
        return;
    }

    if (isSuperAdmin() && !finalShopId) {
        alert("Super Admin: login as a shop admin to add customers for a specific shop, or set shop context.");
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
// Load Customers
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
    // Prefer live days from due date (always accurate for display)
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
    return `<span class="badge" style="background:${m.bg};color:${m.color};white-space:nowrap;">${label}</span>`;
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
    // update hash without reload
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

    const session = getSession();
    const role = session.role || "user";

    tbody.innerHTML = "";

    let rowNum = 0;
    customers.forEach((customer, index) => {
        const bucket = getCustomerAgingBucket(customer);
        if (customerAgingFilter && customerAgingFilter !== "all") {
            if (bucket !== customerAgingFilter) return;
        }

        rowNum++;
        const deleteButton = (role === "admin" || role === "super_admin")
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
            <td>${customer.name}</td>
            <td>${customer.mobile || "-"}</td>
            <td>${customer.village || ""}</td>
            <td>₹${Number(customer.outstanding || 0).toLocaleString("en-IN")}</td>
            <td>${agingBadgeHtml(bucket, getCustomerDaysOverdue(customer))}</td>
            <td>${dueShow}${customer.autoReminder === false ? " 🔕" : ""}</td>
            <td style="white-space:nowrap;">
                <button onclick="viewCustomer(${index})" title="View">👁</button>
                <button onclick="editCustomer(${index})" title="Edit">✏️</button>
                ${waBtn}
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

async function deleteCustomer(index) {
    const session = getSession();
    if (session.role !== "admin" && session.role !== "super_admin") {
        alert("Only Admin Can Delete Records.");
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
        || "Jewellery Shop";
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
        "After payment, contact the shop for receipt / update.",
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

// ================================
// WhatsApp reminder schedule (due + every N days)
// Full auto-send needs Meta WhatsApp Cloud API + cron.
// Here: detect due list + one-click / sequential send + mark sent.
// ================================
function addDaysISO(dateStr, days) {
    const d = new Date(dateStr || new Date());
    if (isNaN(d.getTime())) return todayISO();
    d.setDate(d.getDate() + Number(days || 3));
    return d.toISOString().split("T")[0];
}

function getDueReminderCustomers() {
    const today = todayISO();
    return (customers || []).filter(c => {
        if (c.autoReminder === false) return false;
        if (Number(c.outstanding || 0) <= 0) return false;
        if (!c.mobile) return false;
        const due = c.dueDate || c.followup || c.nextReminderDate;
        if (!due) return false;
        // due today or past, and (no last sent OR next_reminder_date <= today)
        if (due > today && (!c.nextReminderDate || c.nextReminderDate > today)) {
            // only if next_reminder_date is set and due
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
        const next = addDaysISO(todayISO(), interval);
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

    // Part 1 visual analytics — uses existing loaded data only
    if (typeof renderDashboardCharts === "function") renderDashboardCharts();

    // Aging cards (async, non-blocking)
    if (typeof loadAgingDashboard === "function") {
        loadAgingDashboard().catch(function (e) { console.warn("aging", e); });
    }
}



// ================================
// Part 1 Dashboard Charts (visual layer)
// ================================
let dashboardRecoveryChart = null;
let dashboardPortfolioChart = null;
function renderDashboardCharts() {
    if (typeof Chart === "undefined") return;
    const trendCanvas = document.getElementById("recoveryTrendChart");
    const portfolioCanvas = document.getElementById("portfolioStatusChart");
    if (!trendCanvas || !portfolioCanvas) return;
    // Rolling 30-day recovery trend: today + previous 29 calendar days.
    // Zero-recovery days are included so the line always represents a true 30-day window.
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
    dashboardRecoveryChart = new Chart(trendCanvas, {type:"line",data:{labels:labels,datasets:[{label:"Recovery",data:values,borderColor:"#0B6B59",backgroundColor:"#0B6B59",borderWidth:2.5,tension:.42,fill:false,pointRadius:values.length === 1 ? 4 : 2.5,pointHoverRadius:5,pointBackgroundColor:"#ffffff",pointBorderColor:"#0B6B59",pointBorderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:"index"},plugins:{legend:{display:false},tooltip:{displayColors:false,backgroundColor:"#10251f",titleColor:"#d9eee7",bodyColor:"#ffffff",padding:10,cornerRadius:10,callbacks:{label:function(ctx){return "Recovery  ₹" + Number(ctx.raw||0).toLocaleString("en-IN");}}}},scales:{y:{beginAtZero:true,border:{display:false},ticks:{color:"#7a8984",padding:8,callback:function(v){return "₹"+Number(v).toLocaleString("en-IN",{notation:"compact",maximumFractionDigits:1});}},grid:{color:"rgba(15,107,79,.08)",drawTicks:false}},x:{border:{display:false},ticks:{color:"#7a8984",padding:8},grid:{display:false}}}}});
    const today = new Date().toISOString().split("T")[0];
    const total = (customers || []).length;
    const follow = (customers || []).filter(function(c){return c.followup === today;}).length;
    const escalated = (customers || []).filter(function(c){return String(c.status||"").toLowerCase().includes("escalat");}).length;
    const stable = Math.max(total - follow - escalated, 0);
    if (dashboardPortfolioChart) dashboardPortfolioChart.destroy();
    dashboardPortfolioChart = new Chart(portfolioCanvas,{type:"doughnut",data:{labels:["Stable","Follow-up today","Escalated"],datasets:[{data:[stable,follow,escalated],borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{position:"bottom",labels:{boxWidth:9,usePointStyle:true,padding:16}},tooltip:{callbacks:{label:function(ctx){return " "+ctx.label+": "+ctx.raw+" accounts";}}}}}});
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
            <td>${customer.name}</td>
            <td>${customer.mobile}</td>
            <td>${customer.village}</td>
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
            <td>${customer.name}</td>
            <td>${customer.mobile}</td>
            <td>${customer.village}</td>
            <td>₹${Number(customer.outstanding || 0).toLocaleString("en-IN")}</td>
            <td>${customer.followup}</td>
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
            <td>${customer ? customer.name : "-"}</td>
            <td>₹${Number(item.amount || 0).toLocaleString("en-IN")}</td>
            <td>${item.date}</td>
            <td>${item.remarks || "-"}</td>
        </tr>`;
    });
}

// ================================
// Recovery Module
// ================================
async function saveRecovery() {
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

    // Amount 0 allowed = call / follow-up only (must add comment)
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
        alert("No shop context.");
        return;
    }

    const recovery = {
        customerId: customerId.value,
        amount: Number(amount.value),
        date: date.value,
        paymentMode: paymentMode ? paymentMode.value : "Cash",
        receiptNo: receiptNo ? receiptNo.value : "",
        collectedBy: collectedBy ? collectedBy.value : "",
        remarks: remarks ? remarks.value : ""
    };

    try {
        await sbSaveRecovery(recovery, finalShopId);

        if (cust && Number(amount.value || 0) > 0) {
            const newOut = Math.max(0, Number(cust.outstanding || 0) - Number(amount.value));
            await sbUpdateCustomerOutstanding(cust.id, newOut);
        }
        // Also append call note to customer remarks when amount is 0
        if (cust && Number(amount.value || 0) === 0 && remarks && remarks.value.trim()) {
            try {
                const note = "[" + (date.value || "") + "] " + remarks.value.trim();
                const prev = (cust.remarks || "").trim();
                const merged = prev ? (prev + " | " + note) : note;
                const sb = getSupabase();
                await sb.from("customers").update({ remarks: merged }).eq("id", cust.id);
            } catch (e) { console.warn("remarks update", e); }
        }

        const paidAmt = Number(amount.value || 0);
        const newOutForReceipt = cust ? Math.max(0, Number(cust.outstanding || 0) - paidAmt) : 0;
        const receiptSnapshot = {
            amount: paidAmt,
            date: date.value,
            paymentMode: paymentMode ? paymentMode.value : "",
            receiptNo: receiptNo ? receiptNo.value : "",
            remarks: remarks ? remarks.value : "",
            id: null
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
    }
}

function loadRecoveryTable() {
    const tbody = document.getElementById("recoveryBody");
    if (!tbody) return;

    const session = getSession();
    const role = session.role || "user";

    tbody.innerHTML = "";

    recoveries.forEach((item, index) => {
        const customer = (customers || []).find(c => String(c.id) === String(item.customerId));
        const deleteBtn = (role === "admin" || role === "super_admin")
            ? `<button class="action-btn delete-btn" onclick="deleteRecovery(${index})" title="Delete">🗑️</button>`
            : "";

        tbody.innerHTML += `
        <tr>
            <td>${index + 1}</td>
            <td>${customer ? customer.name : "-"}</td>
            <td>₹${Number(item.amount || 0).toLocaleString("en-IN")}</td>
            <td>${item.paymentMode || "-"}</td>
            <td>${item.receiptNo || "-"}</td>
            <td>${item.date || "-"}</td>
            <td>${item.collectedBy || "-"}</td>
            <td>${item.remarks || "-"}</td>
            <td>${deleteBtn}</td>
        </tr>`;
    });
}

async function deleteRecovery(index) {
    const session = getSession();
    if (session.role !== "admin" && session.role !== "super_admin") {
        alert("Only Admin Can Delete Records.");
        return;
    }
    if (!confirm("Delete this recovery entry?")) return;

    const item = recoveries[index];
    try {
        if (item) {
            const customer = (customers || []).find(c => String(c.id) === String(item.customerId));
            if (customer) {
                const newOut = Number(customer.outstanding || 0) + Number(item.amount || 0);
                await sbUpdateCustomerOutstanding(customer.id, newOut);
            }
        }
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

    // bind every time (mobile safe)
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

        // also from customers array (source of truth)
        const c = (customers || []).find(function(x) {
            return String(x.id) === String(val) || String(x.id) === val;
        });
        if (c) out = Number(c.outstanding || 0);

        outBox.value = "₹" + out.toLocaleString("en-IN");
        if (hint) {
            if (out > 0) {
                hint.textContent = "Pending dues — recover up to this amount";
                hint.style.color = "#b91c1c";
            } else {
                hint.textContent = "Outstanding ₹0 — already cleared";
                hint.style.color = "#15803d";
            }
        }
        if (amtBox) {
            amtBox.setAttribute("max", String(out > 0 ? out : ""));
            amtBox.placeholder = out > 0 ? ("Max ₹" + out.toLocaleString("en-IN")) : "Enter amount";
        }
    } catch (e) {
        console.error("onRecoveryCustomerChange", e);
    }
}
window.onRecoveryCustomerChange = onRecoveryCustomerChange;
window.loadRecoveryCustomers = loadRecoveryCustomers;

function bindRecoveryOutstandingUI() {
    var select = document.getElementById("recoveryCustomer");
    if (!select) return;
    select.onchange = onRecoveryCustomerChange;
    select.onclick = onRecoveryCustomerChange;
    select.onblur = onRecoveryCustomerChange;
    if (select.dataset.outBound === "1") return;
    select.dataset.outBound = "1";
    ["change","input","blur","keyup"].forEach(function(ev){
        select.addEventListener(ev, onRecoveryCustomerChange);
    });
}
window.bindRecoveryOutstandingUI = bindRecoveryOutstandingUI;

document.addEventListener("DOMContentLoaded", function(){
    try {
        if (document.getElementById("recoveryCustomer")) {
            if (typeof loadRecoveryCustomers === "function") loadRecoveryCustomers();
            bindRecoveryOutstandingUI();
            setTimeout(onRecoveryCustomerChange, 300);
            setTimeout(onRecoveryCustomerChange, 1000);
        }
    } catch(e) {}
});



// ================================
// Reports
// ================================
function loadReportCustomers() {
    const select = document.getElementById("reportCustomer");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">All Customers</option>`;
    customers.forEach(customer => {
        select.innerHTML += `<option value="${customer.id}">${customer.name}</option>`;
    });
    if (current) select.value = current;
}

function renderReportRows(list) {
    const tbody = document.getElementById("reportBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    list.forEach((item, index) => {
        const customer = (customers || []).find(c => String(c.id) === String(item.customerId));
        const status = customer && Number(customer.outstanding) > 0
            ? `<span class="badge badge-warning">Pending</span>`
            : `<span class="badge badge-success">Paid</span>`;

        tbody.innerHTML += `
        <tr>
            <td>${index + 1}</td>
            <td>${customer ? customer.name : "-"}</td>
            <td>${customer ? (customer.mobile || "-") : "-"}</td>
            <td>${customer ? (customer.village || "-") : "-"}</td>
            <td>₹${Number(item.amount || 0).toLocaleString("en-IN")}</td>
            <td>${item.paymentMode || "-"}</td>
            <td>${item.date || "-"}</td>
            <td>${item.collectedBy || "-"}</td>
            <td>${status}</td>
        </tr>`;
    });

    const totalRecords = document.getElementById("reportTotalRecords");
    const reportAmount = document.getElementById("reportAmount");
    if (totalRecords) totalRecords.innerHTML = list.length;
    if (reportAmount) {
        let sum = 0;
        list.forEach(i => sum += Number(i.amount || 0));
        reportAmount.innerHTML = formatCurrency(sum);
    }
}

function loadReports() {
    try { if (typeof renderAnalyticsOnReports === 'function') renderAnalyticsOnReports(); } catch (e) {}

    loadReportCustomers();
    renderReportRows(recoveries);
    updateRecoverySummary();
    updateReportExtraStats();
}

function getFilteredRecoveries() {
    const fromDate = document.getElementById("fromDate");
    const toDate = document.getElementById("toDate");
    const reportCustomer = document.getElementById("reportCustomer");
    const reportSearch = document.getElementById("reportSearch");

    let list = recoveries.slice();

    if (reportCustomer && reportCustomer.value) {
        list = list.filter(r => String(r.customerId) === String(reportCustomer.value));
    }
    if (fromDate && fromDate.value) {
        list = list.filter(r => r.date >= fromDate.value);
    }
    if (toDate && toDate.value) {
        list = list.filter(r => r.date <= toDate.value);
    }
    if (reportSearch && reportSearch.value.trim() !== "") {
        const keyword = reportSearch.value.trim().toLowerCase();
        list = list.filter(r => {
            const customer = customers.find(c => c.id == r.customerId);
            const name = customer ? (customer.name || "").toLowerCase() : "";
            const mobile = customer ? (customer.mobile || "").toLowerCase() : "";
            const village = customer ? (customer.village || "").toLowerCase() : "";
            return name.includes(keyword) || mobile.includes(keyword) || village.includes(keyword);
        });
    }
    return list;
}

function filterReport() {
    const list = getFilteredRecoveries();
    renderReportRows(list);
    updateReportExtraStats(list);
}

function searchReport() { filterReport(); }
function filterReportByDate() { filterReport(); }

function exportReport() {
    const list = getFilteredRecoveries();
    if (list.length === 0) {
        alert("No data to export.");
        return;
    }
    let csv = "No,Customer,Mobile,Village,Amount,Payment Mode,Date,Collected By,Remarks\n";
    list.forEach((item, index) => {
        const customer = (customers || []).find(c => String(c.id) === String(item.customerId));
        const name = customer ? (customer.name || "-") : "-";
        const mobile = customer ? (customer.mobile || "-") : "-";
        const village = customer ? (customer.village || "-") : "-";
        csv += `${index + 1},"${name}","${mobile}","${village}",${item.amount},"${item.paymentMode || "-"}","${item.date || "-"}","${item.collectedBy || "-"}","${(item.remarks || "").replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Recountix-Recovery-Report.csv";
    a.click();
    URL.revokeObjectURL(url);
}

function updateReportExtraStats(list) {
    list = list || recoveries;
    const totals = {};
    list.forEach(item => {
        const id = item.customerId;
        totals[id] = (totals[id] || 0) + Number(item.amount || 0);
    });
    let topId = null, topAmt = 0;
    Object.keys(totals).forEach(id => {
        if (totals[id] > topAmt) { topAmt = totals[id]; topId = id; }
    });

    const topCustomer = document.getElementById("topCustomer");
    const highestCollection = document.getElementById("highestCollection");
    const activeCustomers = document.getElementById("activeCustomers");
    const pendingCustomers = document.getElementById("pendingCustomers");

    if (topCustomer) {
        if (topId) {
            const c = customers.find(x => x.id == topId);
            topCustomer.innerHTML = c ? c.name : "-";
        } else topCustomer.innerHTML = "-";
    }
    if (highestCollection) highestCollection.innerHTML = formatCurrency(topAmt);
    if (activeCustomers) {
        const activeIds = new Set(list.map(r => String(r.customerId)));
        activeCustomers.innerHTML = activeIds.size;
    }
    if (pendingCustomers) {
        pendingCustomers.innerHTML = customers.filter(c => Number(c.outstanding || 0) > 0).length;
    }
}

function getMonthlyCollection() {
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    let total = 0;
    recoveries.forEach(item => {
        const d = new Date(item.date);
        if (d.getMonth() + 1 === month && d.getFullYear() === year) {
            total += Number(item.amount);
        }
    });
    return total;
}

function getTotalRecovery() {
    let total = 0;
    recoveries.forEach(item => { total += Number(item.amount); });
    return total;
}

function updateRecoverySummary() {
    const today = new Date().toISOString().split("T")[0];
    let todayTotal = 0;
    recoveries.forEach(item => {
        if (item.date === today) todayTotal += Number(item.amount || 0);
    });
    let pendingTotal = 0;
    customers.forEach(c => { pendingTotal += Number(c.outstanding || 0); });

    const totalRecoveryAmount = getTotalRecovery();
    const monthlyAmount = getMonthlyCollection();
    const transactionCount = recoveries.length;

    const fields = {
        todayRecovery: formatCurrency(todayTotal),
        totalRecovery: formatCurrency(totalRecoveryAmount),
        pendingRecovery: formatCurrency(pendingTotal),
        totalTransactions: transactionCount,
        monthlyCollection: formatCurrency(monthlyAmount),
        summaryRecovery: formatCurrency(totalRecoveryAmount),
        summaryPending: formatCurrency(pendingTotal),
        summaryToday: formatCurrency(todayTotal),
        reportTotalCustomers: customers.length,
        reportTotalRecovery: formatCurrency(totalRecoveryAmount),
        reportMonthlyRecovery: formatCurrency(monthlyAmount),
        reportPending: formatCurrency(pendingTotal),
        reportTotalRecords: transactionCount,
        reportAmount: formatCurrency(totalRecoveryAmount),
        reportPendingBalance: formatCurrency(pendingTotal),
        todayCollection: formatCurrency(todayTotal),
        thisMonthCollection: formatCurrency(monthlyAmount),
        reportOutstanding: formatCurrency(pendingTotal)
    };

    Object.keys(fields).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = fields[id];
    });
}

// ================================
// Utilities
// ================================
function formatCurrency(amount) {
    return "₹" + Number(amount || 0).toLocaleString("en-IN");
}

function formatDate(date) {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-IN");
}

function backupData() {
    alert("Data is stored in Supabase cloud.\\nUse Supabase Dashboard → Table Editor for export if needed.");
}

function restoreData() {
    alert("Restore is managed via Supabase. Local JSON restore is disabled.");
}

function clearAllData() {
    alert("Clear All is disabled. Manage data from Supabase Dashboard or delete records individually.");
}

function firebaseFullBackup() { backupData(); }
function firebaseFullRestore() { restoreData(); }

// ================================
// Settings / Users
// ================================
async function saveSettings() {
    if (typeof readUpiSettingsIntoSettingsObj === 'function') readUpiSettingsIntoSettingsObj();
    const usernameField = document.getElementById("adminUsername");
    const currentPasswordField = document.getElementById("currentPassword");
    const newPasswordField = document.getElementById("newPassword");
    const confirmPasswordField = document.getElementById("confirmPassword");
    const recoveryEmailField = document.getElementById("recoveryEmail");

    if (!usernameField) return;

    const session = getSession();
    const newUsername = usernameField.value.trim();
    if (!newUsername) {
        alert("Username Cannot Be Empty");
        return;
    }

    try {
        const currentPassword = currentPasswordField ? currentPasswordField.value.trim() : "";
        const newPassword = newPasswordField ? newPasswordField.value.trim() : "";
        const confirmPassword = confirmPasswordField ? confirmPasswordField.value.trim() : "";

        if (newPassword !== "" || confirmPassword !== "") {
            const check = await sbLogin(session.username, currentPassword);
            if (!check) {
                alert("Current Password Is Incorrect");
                return;
            }
            setSession(check.user, check.shop ? { name: check.shop.name } : null);

            if (newPassword.length < 4) {
                alert("New Password Must Be At Least 4 Characters");
                return;
            }
            if (newPassword !== confirmPassword) {
                alert("New Password And Confirm Password Do Not Match");
                return;
            }
            await sbUpdateUserPassword(session.userId, newPassword);
        }

        if (newUsername !== session.username) {
            await sbUpdateUsername(session.userId, newUsername);
            sessionStorage.setItem("bk_username", newUsername);
        }

        // Always save recovery email on the user account (works for Super Admin too)
        if (recoveryEmailField && session.userId) {
            const re = recoveryEmailField.value.trim();
            const sb = getSupabase();
            await sb.from("users").update({ recovery_email: re || null }).eq("id", session.userId);
        }

        if (session.shopId) {
            const s = await sbGetSettings(session.shopId);
            if (recoveryEmailField) s.recoveryEmail = recoveryEmailField.value.trim();
            await sbSaveSettings(session.shopId, s);
            settings = s;
        }

        if (currentPasswordField) currentPasswordField.value = "";
        if (newPasswordField) newPasswordField.value = "";
        if (confirmPasswordField) confirmPasswordField.value = "";

        alert("Settings Saved Successfully.");
        await loadUserList();
    } catch (e) {
        console.error(e);
        alert("Save failed: " + (e.message || e));
    }
}

async function addUser() {
    const usernameField = document.getElementById("newUserUsername");
    const passwordField = document.getElementById("newUserPassword");
    const roleField = document.getElementById("newUserRole");
    if (!usernameField || !passwordField || !roleField) return;

    const username = usernameField.value.trim();
    const password = passwordField.value.trim();
    let role = roleField.value;
    if (role === "Admin") role = "admin";
    if (role === "User") role = "user";

    if (!username) { alert("Please Enter Username"); return; }
    if (password.length < 4) { alert("Password Must Be At Least 4 Characters"); return; }

    try {
        await sbAddUser({
            username,
            password,
            role,
            shop_id: currentShopId(),
            display_name: username
        });
        usernameField.value = "";
        passwordField.value = "";
        roleField.value = "User";
        alert("User Added Successfully.");
        await loadUserList();
    } catch (e) {
        console.error(e);
        alert("Add user failed: " + (e.message || e));
    }
}

async function deleteUser(usernameOrId) {
    const session = getSession();
    if (!usernameOrId) {
        alert("Invalid user");
        return;
    }
    if (usernameOrId === session.username || usernameOrId === session.userId) {
        alert("You Cannot Delete Your Own Logged-In Account.");
        return;
    }
    if (!confirm("Remove This User Permanently?")) return;

    try {
        // Resolve by id or username (fresh fetch)
        let userId = usernameOrId;
        const looksLikeUuid = String(usernameOrId).length > 20 && String(usernameOrId).includes("-");
        if (!looksLikeUuid) {
            const users = await sbGetUsers(isSuperAdmin() ? null : currentShopId());
            const target = (users || []).find(u =>
                u.id === usernameOrId ||
                u.username === usernameOrId ||
                String(u.id) === String(usernameOrId)
            );
            if (!target) {
                alert("User not found");
                return;
            }
            if (target.username === "superadmin" || target.role === "super_admin") {
                alert("Super Admin account cannot be deleted.");
                return;
            }
            userId = target.id;
        } else {
            // protect superadmin by id lookup optional
            const users = await sbGetUsers(null);
            const t = (users || []).find(u => String(u.id) === String(usernameOrId));
            if (t && (t.username === "superadmin" || t.role === "super_admin")) {
                alert("Super Admin account cannot be deleted.");
                return;
            }
        }
        await sbDeleteUser(userId);
        await loadUserList();
        alert("User removed.");
    } catch (e) {
        console.error(e);
        alert("Delete failed: " + (e.message || e));
    }
}

async function loadUserList() {
    const tbody = document.getElementById("userListBody");
    if (!tbody) return;
    const session = getSession();

    try {
        const shopFilter = isSuperAdmin() ? null : currentShopId();
        const users = await sbGetUsers(shopFilter);
        tbody.innerHTML = "";
        (users || []).forEach(u => {
            const isSelf = u.id === session.userId || u.username === session.username;
            const isSA = u.role === "super_admin" || u.username === "superadmin";
            let action = "—";
            if (!isSelf && !isSA) {
                action = `<button type="button" onclick="deleteUser(this.dataset.uid)" data-uid="${u.id}" title="Remove" style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">🗑️ Remove</button>`;
            }
            tbody.innerHTML += `
            <tr>
                <td>${u.username || ""}</td>
                <td>${u.role || ""}</td>
                <td>${action}</td>
            </tr>`;
        });
    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="3" style="color:#ef4444;">Failed to load users: ${e.message || e}</td></tr>`;
    }
}

function getCompanyName() {
    return settings.company || getSession().shopName || "Recountix";
}

// ================================
// Company Branding
// ================================
function previewCompanyLogo(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
        const preview = document.getElementById("logoPreview");
        if (preview) {
            preview.src = e.target.result;
            preview.style.display = "block";
        }
        settings.logoDataUrl = e.target.result;
        const shopId = currentShopId();
        if (shopId) {
            try {
                await sbSaveSettings(shopId, settings);
            } catch (err) {
                console.error(err);
            }
        }
    };
    reader.readAsDataURL(file);
}

async function saveCompanyBranding() {
    const session = (typeof getSession === "function") ? getSession() : {};
    const shopId = (typeof currentShopId === "function") ? currentShopId() : (session.shopId || null);
    const isSA = (typeof isSuperAdmin === "function" && isSuperAdmin())
        || session.role === "super_admin"
        || session.role === "Super Admin"
        || session.username === "superadmin";

    const companyField = document.getElementById("companyName");
    const phoneField = document.getElementById("companyMobile") || document.getElementById("contactNumber");
    const emailField = document.getElementById("companyEmail") || document.getElementById("emailAddress");
    const addressField = document.getElementById("companyAddress");
    const softwareField = document.getElementById("softwareName");

    if (typeof settings !== "object" || !settings) window.settings = {};

    if (companyField && companyField.value.trim()) settings.company = companyField.value.trim();
    if (phoneField && phoneField.value.trim()) settings.phone = phoneField.value.trim();
    if (emailField && emailField.value.trim()) settings.email = emailField.value.trim();
    if (addressField && addressField.value.trim()) settings.address = addressField.value.trim();
    if (softwareField && softwareField.value.trim()) settings.softwareName = softwareField.value.trim();

    const emailVal = (emailField && emailField.value.trim()) || (settings.email || "");

    try {
        // No shop (Super Admin / missing shop): save recovery email on user
        if (!shopId) {
            const uid = session.userId || session.user_id || "";
            if (!uid) {
                alert("Session expired. Please logout and login again.");
                return;
            }
            if (!emailVal) {
                alert("Enter recovery email in Email Address, then Save.");
                return;
            }
            const sb = getSupabase();
            if (!sb) {
                alert("Cloud connection failed.");
                return;
            }
            const { error } = await sb.from("users").update({ recovery_email: emailVal }).eq("id", uid);
            if (error) {
                // try by username
                const { error: e2 } = await sb.from("users").update({ recovery_email: emailVal }).eq("username", session.username || "superadmin");
                if (e2) throw e2;
            }
            const reField = document.getElementById("recoveryEmail");
            if (reField) reField.value = emailVal;
            alert("✅ Recovery email saved: " + emailVal + "\n\nUse Username + this email on Forgot Password.\n\nNote: Company logo/name is saved by Shop Admin login.");
            return;
        }

        await sbSaveSettings(shopId, settings);
        if (emailVal) {
            try {
                const sb = getSupabase();
                await sb.from("shops").update({ email: emailVal }).eq("id", shopId);
                if (session.userId) {
                    await sb.from("users").update({ recovery_email: emailVal }).eq("id", session.userId);
                }
            } catch (e) { console.warn(e); }
        }
        alert("Company branding saved.");
    } catch (e) {
        console.error(e);
        alert("Save failed: " + (e.message || e));
    }
}

window.saveCompanyBranding = saveCompanyBranding;


// ================================
// Sales / Recovery Executives
// ================================
function getExecutivesList() {
    const list = (typeof settings !== "undefined" && Array.isArray(settings.executives))
        ? settings.executives.slice()
        : ["Mukesh", "Bharat", "Office"];
    return list.filter(x => x && String(x).trim() !== "");
}

function fillExecutiveDropdowns(selected) {
    const list = getExecutivesList();
    const opts = ['<option value="">Select Executive</option>']
        .concat(list.map(e => {
            const sel = (selected && String(selected) === String(e)) ? " selected" : "";
            return `<option value="${String(e).replace(/"/g, "&quot;")}"${sel}>${e}</option>`;
        }))
        .join("");
    const execSel = document.getElementById("executive");
    if (execSel) {
        const cur = selected || execSel.value;
        execSel.innerHTML = opts;
        if (cur) execSel.value = cur;
    }
    const colSel = document.getElementById("collectedBy");
    if (colSel) {
        const cur2 = colSel.value;
        colSel.innerHTML = list.map(e => {
            const sel = (cur2 && String(cur2) === String(e)) ? " selected" : "";
            return `<option value="${String(e).replace(/"/g, "&quot;")}"${sel}>${e}</option>`;
        }).join("") || '<option value="">Select</option>';
        if (cur2) colSel.value = cur2;
    }
}

function loadExecutiveListUI() {
    const tbody = document.getElementById("executiveListBody");
    if (!tbody) return;
    const list = getExecutivesList();
    tbody.innerHTML = list.map((e, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${e}</td>
            <td>
                <button type="button" onclick="removeExecutive(${i})" title="Remove"
                    style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">🗑️</button>
            </td>
        </tr>
    `).join("") || `<tr><td colspan="3" style="text-align:center;color:#94a3b8;">No executives yet. Add below.</td></tr>`;
}

async function addExecutive() {
    const input = document.getElementById("newExecutiveName");
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        alert("Please enter executive name");
        return;
    }
    const shopId = (typeof currentShopId === "function") ? currentShopId() : null;
    if (!shopId) {
        alert("No shop context. Please login as Shop Admin.");
        return;
    }
    if (typeof settings !== "object" || !settings) settings = {};
    if (!Array.isArray(settings.executives)) settings.executives = getExecutivesList();
    if (settings.executives.some(e => e.toLowerCase() === name.toLowerCase())) {
        alert("This executive already exists.");
        return;
    }
    settings.executives.push(name);
    try {
        await sbSaveSettings(shopId, settings);
        input.value = "";
        loadExecutiveListUI();
        fillExecutiveDropdowns();
        try { applyShopBranding(); } catch (e) {}
        alert("Sales Executive added successfully.");
    } catch (e) {
        console.error(e);
        alert("Save failed: " + (e.message || e));
    }
}

async function removeExecutive(index) {
    if (!confirm("Remove this executive?")) return;
    const shopId = (typeof currentShopId === "function") ? currentShopId() : null;
    if (!shopId) {
        alert("No shop context.");
        return;
    }
    if (!Array.isArray(settings.executives)) settings.executives = getExecutivesList();
    settings.executives.splice(index, 1);
    try {
        await sbSaveSettings(shopId, settings);
        loadExecutiveListUI();
        fillExecutiveDropdowns();
        try { applyShopBranding(); } catch (e) {}
    } catch (e) {
        alert("Remove failed: " + (e.message || e));
    }
}

window.getExecutivesList = getExecutivesList;
window.fillExecutiveDropdowns = fillExecutiveDropdowns;
window.loadExecutiveListUI = loadExecutiveListUI;
window.addExecutive = addExecutive;
window.removeExecutive = removeExecutive;


// ================================
// Shop branding (name + logo)
// ================================
function applyShopBranding() {
    const session = (typeof getSession === "function") ? getSession() : {};
    const company = (typeof settings !== "undefined" && settings.company)
        || session.shopName
        || "";
    const logoUrl = (typeof settings !== "undefined" && settings.logoDataUrl)
        || "assets/logo.png";
    const software = (typeof settings !== "undefined" && settings.softwareName)
        || "Recountix";

    // Sidebar logo block
    const logoBox = document.querySelector(".sidebar .logo");
    if (logoBox) {
        let img = logoBox.querySelector("img.shop-brand-logo");
        if (!img) {
            img = document.createElement("img");
            img.className = "shop-brand-logo";
            img.alt = "Logo";
            img.style.cssText = "width:64px;height:64px;object-fit:contain;margin:0 auto 10px;border-radius:12px;background:rgba(255,255,255,0.06);padding:6px;display:block;";
            logoBox.insertBefore(img, logoBox.firstChild);
        }
        img.src = logoUrl;
        img.onerror = function () {
            this.src = "assets/logo.png";
            this.onerror = function () { this.style.display = "none"; };
        };

        let h2 = logoBox.querySelector("h2");
        if (!h2) {
            h2 = document.createElement("h2");
            logoBox.appendChild(h2);
        }
        // Short title for sidebar
        h2.textContent = "Recountix";
        h2.title = "Recountix";

        let p = logoBox.querySelector("p");
        if (!p) {
            p = document.createElement("p");
            logoBox.appendChild(p);
        }
        if (session.role === "super_admin" && !session.shopId) {
            p.textContent = "Super Admin";
        } else {
            p.textContent = company || "Beyond What’s Due.";
        }
    }

    // Topbar / page titles
    const shopLabel = document.getElementById("currentShopName");
    if (shopLabel && company) shopLabel.innerText = company;

    // Reports print header
    const printName = document.getElementById("printCompanyName");
    if (printName) printName.textContent = company || "Jewellery Shop";

    const printLogo = document.querySelector(".print-header img");
    if (printLogo) {
        printLogo.src = logoUrl;
        printLogo.onerror = function () { this.style.display = "none"; };
    }

    // Any element with data-brand="company"
    document.querySelectorAll("[data-brand='company']").forEach(el => {
        el.textContent = company || el.textContent;
    });

    // Footer company lines
    document.querySelectorAll(".footer, footer").forEach(el => {
        // don't overwrite entire footer; optional small brand line
    });

    // Document title
    if (company && session.role !== "super_admin") {
        document.title = company + " | Recountix";
    }
}

window.applyShopBranding = applyShopBranding;

// ================================
// Data reload
// ================================
async function reloadAllData() {
    const session = getSession();
    // Super Admin must NOT see other jewellers' customer/recovery data
    // Only load when a shop context (session.shopId) exists
    const shopFilter = session.shopId || null;

    try {
        const [c, r] = await Promise.all([
            sbGetCustomers(shopFilter),
            sbGetRecoveries(shopFilter)
        ]);
        customers = c;
        recoveries = r;

        if (session.shopId) {
            settings = await sbGetSettings(session.shopId);
        }

        if (typeof enforceSuperAdminDataPrivacy === "function") enforceSuperAdminDataPrivacy();
        if (document.getElementById("customerBody")) { applyHashAgingFilter(); loadCustomers(); }
        if (document.getElementById("totalCustomers")) {
            updateDashboard();
            if (document.getElementById("recentCustomerBody")) loadRecentCustomers();
            if (document.getElementById("dashboardFollowupBody")) loadDashboardFollowups();
            if (document.getElementById("dashboardRecoveryBody")) loadDashboardRecentRecovery();
        }
        if (document.getElementById("recoveryBody")) {
            loadRecoveryTable();
            updateRecoverySummary();
        }
        if (document.getElementById("recoveryCustomer")) loadRecoveryCustomers();
        if (document.getElementById("reportBody")) loadReports();
        try { applyShopBranding(); } catch (be) {}
    } catch (e) {
        console.error("reloadAllData", e);
    }
}

// ================================
// Init
// ================================
window.addEventListener("load", async function () {
    if (typeof supabaseBoot === "function") {
        try { await supabaseBoot(); } catch (e) { console.error(e); }
    }

    checkLogin();

    // If Super Admin switched maintenance ON, immediately remove normal users
    // from every protected page before loading customer/recovery data.
    if (typeof enforceMaintenanceGate === "function") {
        const redirectedForMaintenance = await enforceMaintenanceGate();
        if (redirectedForMaintenance) return;
    }

    const session = getSession();
    if (!session.isLoggedIn && !window.location.pathname.includes("login.html")) return;

    await reloadAllData();

    if (document.getElementById("adminUsername")) {
        document.getElementById("adminUsername").value = session.username || "";
        if (document.getElementById("recoveryEmail") && settings.recoveryEmail) {
            document.getElementById("recoveryEmail").value = settings.recoveryEmail;
        }
        await loadUserList();
    }
    fillExecutiveDropdowns();
        try { applyShopBranding(); } catch (e) {}
    if (document.getElementById("executiveListBody")) loadExecutiveListUI();

    if (document.getElementById("companyName") && settings.company) {
        document.getElementById("companyName").value = settings.company;
    }
    if (document.getElementById("logoPreview") && settings.logoDataUrl) {
        document.getElementById("logoPreview").src = settings.logoDataUrl;
        document.getElementById("logoPreview").style.display = "block";
    }
});

function refreshProject() {
    reloadAllData();
}

const APP_INFO = {
    name: "Recountix",
    version: "Rc.0.05",
    company: "Recountix",
    developer: "BK Design Hub"
};

console.log(APP_INFO.name + " v" + APP_INFO.version);


function filterDashboardMetric(type) {
    document.querySelectorAll(".metric-active").forEach(el => el.classList.remove("metric-active"));
    const today = (typeof todayISO === "function") ? todayISO() : new Date().toISOString().split("T")[0];
    let list = [];
    let title = "";
    if (type === "customers") {
        list = customers || [];
        title = "All Customers (" + list.length + ")";
    } else if (type === "outstanding") {
        list = (customers || []).filter(c => Number(c.outstanding || 0) > 0);
        title = "Outstanding Customers (" + list.length + ")";
    } else if (type === "followup") {
        list = (customers || []).filter(c => c.followup && String(c.followup).slice(0,10) === today);
        title = "Today's Follow-up (" + list.length + ")";
    } else if (type === "recovery") {
        list = (recoveries || []).filter(r => String(r.date || r.recovery_date || "").slice(0,10) === today);
        title = "Today's Recovery (" + list.length + ")";
    }
    const box = document.getElementById("dashboardMetricList");
    if (!box) {
        // navigate to customers with hash
        if (type === "recovery") location.href = "recovery.html";
        else location.href = "customers.html#" + type;
        return;
    }
    box.style.display = "block";
    box.querySelector("h3").textContent = title;
    const tb = box.querySelector("tbody");
    if (type === "recovery") {
        tb.innerHTML = list.map((r,i) => {
            const cust = (customers||[]).find(c => c.id === r.customerId || c.id === r.customer_id);
            return `<tr><td>${i+1}</td><td>${(cust&&cust.name)||"-"}</td><td>₹${Number(r.amount||0).toLocaleString("en-IN")}</td><td>${r.date||r.recovery_date||""}</td></tr>`;
        }).join("") || `<tr><td colspan="4">No records</td></tr>`;
    } else {
        tb.innerHTML = list.map((c,i) =>
            `<tr><td>${i+1}</td><td>${c.name||""}</td><td>${c.mobile||""}</td><td>₹${Number(c.outstanding||0).toLocaleString("en-IN")}</td><td>${c.followup||""}</td></tr>`
        ).join("") || `<tr><td colspan="5">No records</td></tr>`;
    }
}
window.filterDashboardMetric = filterDashboardMetric;

async function logAudit(action, entityType, entityId, details) {
    try {
        const sb = getSupabase();
        if (!sb) return;
        const session = getSession();
        await sb.from("audit_log").insert({
            shop_id: session.shopId || null,
            user_id: session.userId || null,
            username: session.username || "",
            action: action,
            entity_type: entityType || "",
            entity_id: entityId ? String(entityId) : "",
            details: details || ""
        });
    } catch (e) { console.warn("audit", e); }
}
window.logAudit = logAudit;

function printCleanReport() {
    try {
        const body = document.getElementById("cprBody");
        if (!body) { window.print(); return; }

        const fromEl = document.getElementById("fromDate");
        const toEl = document.getElementById("toDate");
        const searchEl = document.getElementById("reportSearch");
        const custEl = document.getElementById("reportCustomer");

        // ONLY recoveries in selected period (today if dates = today)
        let recs = (typeof recoveries !== "undefined" && recoveries) ? recoveries.slice() : [];
        if (fromEl && fromEl.value) {
            recs = recs.filter(function(r){
                return String(r.date || r.recovery_date || "").slice(0,10) >= fromEl.value;
            });
        }
        if (toEl && toEl.value) {
            recs = recs.filter(function(r){
                return String(r.date || r.recovery_date || "").slice(0,10) <= toEl.value;
            });
        }
        if (custEl && custEl.value) {
            recs = recs.filter(function(r){
                return String(r.customerId || r.customer_id) === String(custEl.value);
            });
        }
        if (searchEl && searchEl.value && searchEl.value.trim()) {
            var q = searchEl.value.trim().toLowerCase();
            recs = recs.filter(function(r){
                var c = (customers || []).find(function(x){ return String(x.id) === String(r.customerId || r.customer_id); }) || {};
                return String(c.name || "").toLowerCase().indexOf(q) >= 0
                    || String(c.mobile || "").indexOf(q) >= 0
                    || String(c.village || "").toLowerCase().indexOf(q) >= 0;
            });
        }

        // Group by customer for sheet columns (only who recovered in period)
        var map = {};
        recs.forEach(function(r) {
            var id = String(r.customerId || r.customer_id || "");
            var c = (customers || []).find(function(x){ return String(x.id) === id; }) || {};
            if (!map[id]) {
                map[id] = {
                    name: c.name || "-",
                    city: c.village || c.city || c.district || "-",
                    bill: Number(c.bill || 0),
                    received: 0,
                    due: Number(c.outstanding || 0),
                    comment: c.remarks || ""
                };
            }
            map[id].received += Number(r.amount || 0);
            if (r.remarks) map[id].comment = r.remarks;
        });

        var rows = Object.keys(map).map(function(k){ return map[k]; });
        var totalReceived = 0, totalDue = 0;

        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="7" style="text-align:center">No recovery in this period</td></tr>';
        } else {
            body.innerHTML = rows.map(function(r, i) {
                var totalAmt = r.bill || (r.due + r.received);
                totalReceived += r.received;
                totalDue += r.due;
                var comment = String(r.comment || "-").replace(/</g, "&lt;");
                return "<tr><td>" + (i+1) + "</td><td>" + r.name + "</td><td>" + r.city + "</td><td>₹" + Number(totalAmt).toLocaleString("en-IN") + "</td><td>₹" + Number(r.received).toLocaleString("en-IN") + "</td><td>₹" + Number(r.due).toLocaleString("en-IN") + "</td><td>" + comment + "</td></tr>";
            }).join("");
        }

        var elT = document.getElementById("cprTotalAmt");
        var elO = document.getElementById("cprTotalOut");
        if (elT) elT.textContent = "₹" + totalReceived.toLocaleString("en-IN");
        if (elO) elO.textContent = "₹" + totalDue.toLocaleString("en-IN");

        var shop = "";
        try { if (typeof getSession === "function") shop = getSession().shopName || ""; } catch(e) {}
        var sn = document.getElementById("cprShopName");
        if (sn) sn.textContent = shop || (typeof settings !== "undefined" && settings && settings.company) || "Recountix";
        var dl = document.getElementById("cprDateLine");
        if (dl) dl.textContent = "Printed: " + new Date().toLocaleString("en-IN");
        var fl = document.getElementById("cprFilterLine");
        if (fl) fl.textContent = "Period: " + ((fromEl && fromEl.value) || "All") + " to " + ((toEl && toEl.value) || "All") + " | Recovery only";

        var box = document.getElementById("cleanPrintReport");
        if (box) box.style.display = "block";
        setTimeout(function() {
            window.print();
            setTimeout(function(){ if (box) box.style.display = ""; }, 500);
        }, 200);
    } catch (err) {
        console.error("printCleanReport", err);
        alert("Print error: " + (err.message || err));
        window.print();
    }
}
window.printCleanReport = printCleanReport;

function onRecoveryAmountInput() {
    var amount = document.getElementById("recoveryAmount");
    var select = document.getElementById("recoveryCustomer");
    var hint = document.getElementById("recoveryOutHint");
    if (!amount || !select || !select.value) return;
    var c = (customers || []).find(function(x){ return String(x.id) === String(select.value); });
    if (!c) return;
    var due = Number(c.outstanding || 0);
    var pay = Number(amount.value || 0);
    if (pay > due + 0.001) {
        amount.style.borderColor = "#ef4444";
        amount.style.background = "#fef2f2";
        if (hint) {
            hint.textContent = "Error: Outstanding ₹" + due.toLocaleString("en-IN") + " — you entered ₹" + pay.toLocaleString("en-IN") + " more than due";
            hint.style.color = "#b91c1c";
        }
    } else {
        amount.style.borderColor = "";
        amount.style.background = "";
        if (hint && due > 0) {
            hint.textContent = "Pending dues — recover up to this amount";
            hint.style.color = "#b91c1c";
        }
    }
}
window.onRecoveryAmountInput = onRecoveryAmountInput;

// ================================
// Aging Dashboard
// ================================
let lastAgingSummary = null;

function formatAgingINR(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN");
}

async function loadAgingDashboard() {
    const el030 = document.getElementById("agingBucket030");
    if (!el030) return;

    try {
        const session = (typeof getSession === "function") ? getSession() : {};
        const shopId = session.shopId || null;

        // Always compute day-wise from loaded customers (works even if RPC blocked by RLS)
        let client = buildClientAgingSummary(typeof customers !== "undefined" ? customers : []);

        if (shopId && typeof sbGetAgingSummary === "function") {
            try {
                const summary = await sbGetAgingSummary(shopId);
                if (summary && (Number(summary.total_overdue) > 0 || Number(summary.bucket_0_30) > 0)) {
                    client = Object.assign({}, client, {
                        bucket_0_30: summary.bucket_0_30,
                        bucket_31_60: summary.bucket_31_60,
                        bucket_61_90: summary.bucket_61_90,
                        bucket_90_plus: summary.bucket_90_plus,
                        total_overdue: summary.total_overdue,
                        open_ptp: summary.open_ptp,
                        open_escalations: summary.open_escalations,
                        total_customers: summary.total_customers || client.total_customers
                    });
                } else {
                    client.open_ptp = summary && summary.open_ptp;
                    client.open_escalations = summary && summary.open_escalations;
                }
            } catch (e) {
                console.warn("aging RPC", e);
            }
        }
        lastAgingSummary = client;
        renderAgingSummary(client);
    } catch (e) {
        console.error("loadAgingDashboard", e);
    }
}

function renderAgingSummary(s) {
    const set = (id, val, money) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = money ? formatAgingINR(val) : String(val ?? 0);
    };
    set("agingBucket030", s.bucket_0_30, true);
    set("agingBucket3160", s.bucket_31_60, true);
    set("agingBucket6190", s.bucket_61_90, true);
    set("agingBucket90", s.bucket_90_plus, true);
    set("agingTotalOverdue", s.total_overdue, true);
    set("agingOpenPtp", s.open_ptp, false);
    set("agingOpenEsc", s.open_escalations, false);
    set("agingTotalCust", s.total_customers, false);

    // Counts under cards
    const setC = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = (n || 0) + " accounts"; };
    setC("agingCount030", s.count_0_30);
    setC("agingCount3160", s.count_31_60);
    setC("agingCount6190", s.count_61_90);
    setC("agingCount90", s.count_90);

    // Day-wise detail table
    const tbody = document.getElementById("agingDaysBody");
    if (tbody) {
        const rows = s.rows || [];
        if (!rows.length) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;color:#64748b;'>Only entries with an outstanding balance and due date appear in aging. Set a Payment Due Date for the customer.</td></tr>";
        } else {
            tbody.innerHTML = rows.slice(0, 50).map((r, i) => {
                const badge = agingBadgeHtml(r.bucket, r.days);
                return `<tr>
                  <td>${i + 1}</td>
                  <td>${r.name || "—"}</td>
                  <td>₹${Number(r.outstanding || 0).toLocaleString("en-IN")}</td>
                  <td><strong>${r.days}</strong> days</td>
                  <td>${badge}<br><small style="color:#64748b">Due: ${r.due || "—"}</small></td>
                </tr>`;
            }).join("");
        }
    }
}

async function refreshAgingDashboard() {
    try {
        const session = (typeof getSession === "function") ? getSession() : {};
        const shopId = session.shopId || null;
        if (typeof sbRecalcAging === "function" && shopId) {
            await sbRecalcAging(shopId);
        }
        await loadAgingDashboard();
        if (typeof reloadAllData === "function") await reloadAllData();
    } catch (e) {
        console.error(e);
        alert("Aging refresh failed: " + (e.message || e));
    }
}

function filterByAgingBucket(bucket) {
    // Navigate to customers with hash filter
    const map = {
        "0-30": "aging_0_30",
        "31-60": "aging_31_60",
        "61-90": "aging_61_90",
        "90+": "aging_90"
    };
    const key = map[bucket] || bucket;
    window.location.href = "customers.html#" + key;
}

window.loadAgingDashboard = loadAgingDashboard;
window.refreshAgingDashboard = refreshAgingDashboard;
window.filterByAgingBucket = filterByAgingBucket;
window.renderAgingSummary = renderAgingSummary;

// ================================
// Promise to Pay (PTP) Module
// ================================
let ptpListCache = [];

async function initPtpPage() {
    if (!document.getElementById("ptpTableBody")) return;
    // default date = today
    const d = document.getElementById("ptpDate");
    if (d && !d.value) d.value = new Date().toISOString().split("T")[0];
    await fillPtpCustomerDropdown();
    await loadPtpTable();
}

async function fillPtpCustomerDropdown() {
    const sel = document.getElementById("ptpCustomer");
    if (!sel) return;
    try {
        if (typeof reloadAllData === "function" && (!window.customers || !customers.length)) {
            await reloadAllData();
        }
        const list = (typeof customers !== "undefined" && customers) ? customers : [];
        // prefer outstanding > 0 first
        const sorted = list.slice().sort((a, b) => Number(b.outstanding || 0) - Number(a.outstanding || 0));
        sel.innerHTML = '<option value="">Select customer</option>' +
            sorted.map(c => {
                const out = Number(c.outstanding || 0);
                const label = (c.name || "-") + (out ? " (₹" + out.toLocaleString("en-IN") + ")" : "");
                return '<option value="' + c.id + '" data-out="' + out + '">' + label + "</option>";
            }).join("");
    } catch (e) {
        console.error(e);
    }
}

function clearPtpForm() {
    const c = document.getElementById("ptpCustomer");
    const a = document.getElementById("ptpAmount");
    const d = document.getElementById("ptpDate");
    const n = document.getElementById("ptpNotes");
    if (c) c.value = "";
    if (a) a.value = "";
    if (d) d.value = new Date().toISOString().split("T")[0];
    if (n) n.value = "";
}

async function savePtpForm() {
    const customerId = (document.getElementById("ptpCustomer") || {}).value;
    const amount = Number((document.getElementById("ptpAmount") || {}).value || 0);
    const date = (document.getElementById("ptpDate") || {}).value;
    const notes = ((document.getElementById("ptpNotes") || {}).value || "").trim();

    if (!customerId) { alert("Please select customer"); return; }
    if (!date) { alert("Please select promised date"); return; }
    if (amount < 0) { alert("Amount cannot be negative"); return; }

    const session = (typeof getSession === "function") ? getSession() : {};
    const shopId = session.shopId;
    if (!shopId) {
        alert("No shop context. Login as shop admin/user.");
        return;
    }

    try {
        await sbSavePtp({
            shop_id: shopId,
            customer_id: customerId,
            agent_id: session.userId || null,
            promised_amount: amount,
            promised_date: date,
            notes: notes,
            status: "open",
            created_by: session.userId || null
        });
        alert("Promise saved successfully.");
        clearPtpForm();
        await loadPtpTable();
        if (typeof loadAgingDashboard === "function") loadAgingDashboard();
    } catch (e) {
        console.error(e);
        alert("Save failed: " + (e.message || e));
    }
}

async function loadPtpTable() {
    const tbody = document.getElementById("ptpTableBody");
    if (!tbody) return;
    const status = (document.getElementById("ptpStatusFilter") || {}).value || "open";
    const session = (typeof getSession === "function") ? getSession() : {};
    const shopId = session.shopId || null;

    tbody.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';
    try {
        if (typeof customers === "undefined" || !customers.length) {
            if (typeof reloadAllData === "function") await reloadAllData();
        }
        ptpListCache = await sbGetPtp(shopId, status);
        // counts from all statuses for cards
        const all = await sbGetPtp(shopId, "all");
        const today = new Date().toISOString().split("T")[0];
        const setN = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
        setN("ptpCountOpen", all.filter(p => p.status === "open").length);
        setN("ptpCountToday", all.filter(p => p.status === "open" && p.promised_date === today).length);
        setN("ptpCountKept", all.filter(p => p.status === "kept").length);
        setN("ptpCountBroken", all.filter(p => p.status === "broken").length);

        if (!ptpListCache.length) {
            tbody.innerHTML = '<tr><td colspan="7">No promises found</td></tr>';
            return;
        }

        tbody.innerHTML = ptpListCache.map((p, i) => {
            const cust = (customers || []).find(c => String(c.id) === String(p.customer_id));
            const name = cust ? cust.name : (p.customer_id || "-");
            const st = p.status || "open";
            const badge =
                st === "open" ? "badge-info" :
                st === "kept" ? "badge-success" :
                st === "broken" ? "badge-danger" : "badge-warning";
            let actions = "";
            if (st === "open") {
                actions =
                    '<button type="button" class="add-btn" style="padding:6px 10px;font-size:12px;" onclick="markPtpKept(\'' + p.id + '\')">Kept</button> ' +
                    '<button type="button" class="add-btn" style="padding:6px 10px;font-size:12px;background:#dc2626;" onclick="markPtpBroken(\'' + p.id + '\')">Broken</button> ' +
                    '<button type="button" class="btn-cancel" style="padding:6px 10px;font-size:12px;" onclick="markPtpCancelled(\'' + p.id + '\')">Cancel</button>';
            } else {
                actions = '<span style="color:#73879B;font-size:12px;">—</span>';
            }
            return '<tr>' +
                '<td>' + (i + 1) + '</td>' +
                '<td>' + name + '</td>' +
                '<td>₹' + Number(p.promised_amount || 0).toLocaleString("en-IN") + '</td>' +
                '<td>' + (p.promised_date || "") + '</td>' +
                '<td><span class="badge ' + badge + '">' + st + '</span></td>' +
                '<td>' + (p.notes || "—") + '</td>' +
                '<td>' + actions + '</td>' +
                '</tr>';
        }).join("");
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="7">Error: ' + (e.message || e) + '</td></tr>';
    }
}

async function markPtpKept(id) {
    if (!confirm("Mark this promise as KEPT? (Customer paid as promised)")) return;
    try {
        await sbUpdatePtpStatus(id, "kept");
        alert("Marked as kept.");
        await loadPtpTable();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

async function markPtpBroken(id) {
    if (!confirm("Mark as BROKEN? This will create an escalation.")) return;
    try {
        await sbUpdatePtpStatus(id, "broken");
        alert("Marked as broken + escalation created.");
        await loadPtpTable();
        if (typeof loadAgingDashboard === "function") loadAgingDashboard();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

async function markPtpCancelled(id) {
    if (!confirm("Cancel this promise?")) return;
    try {
        await sbUpdatePtpStatus(id, "cancelled");
        await loadPtpTable();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

async function runBrokenPtpCheck() {
    if (!confirm("Process all overdue open PTPs as broken (server function)?")) return;
    try {
        const sb = getSupabase();
        if (!sb) throw new Error("Supabase not ready");
        const { data, error } = await sb.rpc("process_broken_ptp", { p_grace_days: 1 });
        if (error) throw error;
        alert("Processed. Broken count: " + (data ?? 0));
        await loadPtpTable();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

window.initPtpPage = initPtpPage;
window.savePtpForm = savePtpForm;
window.clearPtpForm = clearPtpForm;
window.loadPtpTable = loadPtpTable;
window.markPtpKept = markPtpKept;
window.markPtpBroken = markPtpBroken;
window.markPtpCancelled = markPtpCancelled;
window.runBrokenPtpCheck = runBrokenPtpCheck;

// ================================
// PHASE 2: Payment link, Receipt, Agent, Escalations
// ================================

function getShopUpiId() {
    // settings.extra.upi_id or settings.upiId or local
    try {
        if (typeof settings !== "undefined" && settings) {
            if (settings.upiId) return String(settings.upiId).trim();
            if (settings.extra && settings.extra.upi_id) return String(settings.extra.upi_id).trim();
        }
    } catch (e) {}
    try {
        const s = JSON.parse(localStorage.getItem("settings") || "{}");
        return (s.upiId || (s.extra && s.extra.upi_id) || "").trim();
    } catch (e) {}
    return "";
}

function buildUpiPayUrl(upiId, name, amount, note) {
    const pa = encodeURIComponent(upiId);
    const pn = encodeURIComponent(name || "Payment");
    const am = amount ? ("&am=" + encodeURIComponent(Number(amount).toFixed(2))) : "";
    const tn = note ? ("&tn=" + encodeURIComponent(note)) : "";
    return "upi://pay?pa=" + pa + "&pn=" + pn + am + tn + "&cu=INR";
}

async function openPaymentLinkForCustomer(index) {
    const c = customers[index];
    if (!c) return;
    const upi = getShopUpiId();
    const amount = Number(c.outstanding || 0);
    if (amount <= 0) {
        alert("Outstanding balance is ₹0 — no payment link is required.");
        return;
    }
    let upiId = upi;
    if (!upiId) {
        upiId = prompt("Enter the shop UPI ID (e.g. shop@oksbi):\n\n(You can save it in Settings)", "");
        if (!upiId) return;
        try {
            if (typeof settings === "undefined" || !settings) window.settings = {};
            settings.upiId = upiId.trim();
            if (typeof sbSaveSettings === "function" && typeof currentShopId === "function" && currentShopId()) {
                await sbSaveSettings(settings, currentShopId());
            }
        } catch (e) { console.warn(e); }
    }
    const shopName = (typeof getSession === "function" && getSession().shopName) || "Shop";
    const note = "Due " + (c.name || "");
    const upiUrl = buildUpiPayUrl(upiId.trim(), shopName, amount, note);
    const text =
        "Namaste " + (c.name || "") + ",\n\n" +
        "Your outstanding balance: ₹" + amount.toLocaleString("en-IN") + "\n" +
        "Shop: " + shopName + "\n" +
        "UPI: " + upiId.trim() + "\n\n" +
        "Please keep the receipt after making the payment.\n" +
        "Thank you.";

    // save row (best effort)
    try {
        const session = getSession();
        if (session.shopId && c.id) {
            await sbCreatePaymentLinkRow({
                shop_id: session.shopId,
                customer_id: c.id,
                amount: amount,
                gateway: "upi",
                short_url: upiUrl,
                notes: "UPI link for " + c.name,
                created_by: session.userId
            });
        }
    } catch (e) { console.warn("payment_links", e); }

    const mobile = String(c.mobile || "").replace(/\D/g, "");
    const wa = mobile.length >= 10
        ? ("https://wa.me/91" + mobile.slice(-10) + "?text=" + encodeURIComponent(text + "\n\nUPI app: " + upiUrl))
        : null;

    if (wa && confirm("Send the payment request on WhatsApp?\n\nOK = WhatsApp\nCancel = Copy UPI link")) {
        window.open(wa, "_blank");
    } else {
        try {
            await navigator.clipboard.writeText(text + "\n" + upiUrl);
            alert("Payment message and UPI link copied.\n\nUPI: " + upiId);
        } catch (e) {
            prompt("Copy:", text + "\n" + upiUrl);
        }
    }
}

function printRecoveryReceipt(opts) {
    const shop = (typeof getSession === "function" && getSession().shopName) || "Recountix";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;max-width:420px;margin:auto;color:#111}
      h1{font-size:18px;margin:0 0 4px}
      .muted{color:#666;font-size:12px}
      .box{border:1px solid #ddd;border-radius:12px;padding:16px;margin-top:16px}
      .row{display:flex;justify-content:space-between;margin:8px 0;font-size:14px}
      .amt{font-size:22px;font-weight:700;color:#1A3D63}
      @media print{button{display:none}}
    </style></head><body>
    <h1>${shop}</h1>
    <div class="muted">Payment Receipt</div>
    <div class="box">
      <div class="row"><span>Receipt No</span><strong>${opts.receiptNo || "—"}</strong></div>
      <div class="row"><span>Date</span><strong>${opts.date || ""}</strong></div>
      <div class="row"><span>Customer</span><strong>${opts.customerName || ""}</strong></div>
      <div class="row"><span>Mobile</span><strong>${opts.mobile || "—"}</strong></div>
      <div class="row"><span>Mode</span><strong>${opts.mode || "—"}</strong></div>
      <div class="row"><span>Amount</span><span class="amt">₹${Number(opts.amount || 0).toLocaleString("en-IN")}</span></div>
      <div class="row"><span>Outstanding after</span><strong>₹${Number(opts.outstandingAfter || 0).toLocaleString("en-IN")}</strong></div>
      ${opts.remarks ? '<div class="row"><span>Notes</span><span>' + opts.remarks + "</span></div>" : ""}
    </div>
    <p class="muted" style="margin-top:16px;">Thank you for your payment.</p>
    <button onclick="window.print()">Print</button>
    </body></html>`;
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) {
        alert("Popup blocked — allow popups for receipt.");
        return;
    }
    w.document.write(html);
    w.document.close();
}

async function afterRecoveryReceipt(recovery, cust, newOut) {
    if (!recovery || Number(recovery.amount || 0) <= 0) return;
    const session = getSession();
    let receiptNo = recovery.receiptNo || "";
    let saved = null;
    try {
        if (recovery.id && session.shopId) {
            saved = await sbSaveReceiptRow({
                shop_id: session.shopId,
                recovery_id: recovery.id,
                customer_id: cust && cust.id,
                receipt_no: receiptNo || undefined,
                amount: recovery.amount
            });
            if (saved && saved.receipt_no) receiptNo = saved.receipt_no;
        }
    } catch (e) {
        console.warn("receipt save", e);
        if (!receiptNo) receiptNo = "R-" + Date.now();
    }
    if (confirm("Print or open the receipt?")) {
        printRecoveryReceipt({
            receiptNo: receiptNo,
            date: recovery.date,
            customerName: cust ? cust.name : "",
            mobile: cust ? cust.mobile : "",
            mode: recovery.paymentMode,
            amount: recovery.amount,
            outstandingAfter: newOut,
            remarks: recovery.remarks
        });
    }
}

// Patch note: saveRecovery should call afterRecoveryReceipt — done via wrap below

window.openPaymentLinkForCustomer = openPaymentLinkForCustomer;
window.printRecoveryReceipt = printRecoveryReceipt;
window.afterRecoveryReceipt = afterRecoveryReceipt;
window.getShopUpiId = getShopUpiId;

async function loadEscalationsTable() {
    const tbody = document.getElementById("escTableBody");
    if (!tbody) return;
    const status = (document.getElementById("escStatusFilter") || {}).value || "open";
    const session = getSession();
    tbody.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';
    try {
        if ((!customers || !customers.length) && typeof reloadAllData === "function") await reloadAllData();
        const all = await sbGetEscalations(session.shopId, "all");
        const setN = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
        setN("escOpen", all.filter(e => e.status === "open").length);
        setN("escProgress", all.filter(e => e.status === "in_progress").length);
        setN("escResolved", all.filter(e => e.status === "resolved").length);
        const list = status === "all" ? all : all.filter(e => e.status === status);
        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="7">No escalations</td></tr>';
            return;
        }
        tbody.innerHTML = list.map((e, i) => {
            const cust = (customers || []).find(c => String(c.id) === String(e.customer_id));
            const name = cust ? cust.name : (e.customer_id || "—");
            let actions = "";
            if (e.status === "open" || e.status === "in_progress") {
                actions =
                    (e.status === "open" ? `<button type="button" class="add-btn" style="padding:6px 10px;font-size:12px;" onclick="setEscalationStatus('${e.id}','in_progress')">Start</button> ` : "") +
                    `<button type="button" class="add-btn" style="padding:6px 10px;font-size:12px;background:#16a34a;" onclick="setEscalationStatus('${e.id}','resolved')">Resolve</button> ` +
                    `<button type="button" class="btn-cancel" style="padding:6px 10px;font-size:12px;" onclick="setEscalationStatus('${e.id}','dismissed')">Dismiss</button>`;
            } else actions = "—";
            return `<tr>
              <td>${i + 1}</td>
              <td>${name}</td>
              <td>${e.reason || ""}</td>
              <td>${e.level || 1}</td>
              <td>${e.notes || "—"}</td>
              <td>${e.status || ""}</td>
              <td style="white-space:nowrap;">${actions}</td>
            </tr>`;
        }).join("");
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="7">Error: ' + (err.message || err) + "</td></tr>";
    }
}

async function setEscalationStatus(id, status) {
    try {
        const patch = { status: status };
        if (status === "resolved") {
            patch.resolved_at = new Date().toISOString();
            const session = getSession();
            patch.resolved_by = session.userId ? String(session.userId) : null;
        }
        await sbUpdateEscalation(id, patch);
        await loadEscalationsTable();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

window.loadEscalationsTable = loadEscalationsTable;
window.setEscalationStatus = setEscalationStatus;



function fillUpiSettingsField() {
    const el = document.getElementById("upiId");
    if (!el) return;
    el.value = getShopUpiId() || "";
}
function readUpiSettingsIntoSettingsObj() {
    const el = document.getElementById("upiId");
    if (!el) return;
    if (typeof settings === "undefined" || !settings) window.settings = {};
    settings.upiId = (el.value || "").trim();
}
window.fillUpiSettingsField = fillUpiSettingsField;
window.readUpiSettingsIntoSettingsObj = readUpiSettingsIntoSettingsObj;

// ================================
// PHASE 3: Activity log, Legal notice, Analytics
// ================================

async function saveActivityForm() {
    const customerId = (document.getElementById("actCustomer") || {}).value;
    const type = (document.getElementById("actType") || {}).value || "call";
    const outcome = (document.getElementById("actOutcome") || {}).value || "";
    const notes = ((document.getElementById("actNotes") || {}).value || "").trim();
    if (!customerId) { alert("Please select a customer."); return; }
    if (!notes && !outcome) { alert("Please enter notes or an outcome."); return; }
    const session = getSession();
    if (!session.shopId) { alert("Shop context is unavailable."); return; }

    let gps_lat = null, gps_lng = null;
    if (document.getElementById("actCaptureGps") && document.getElementById("actCaptureGps").checked) {
        try {
            const pos = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) return reject(new Error("No GPS"));
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
            });
            gps_lat = pos.coords.latitude;
            gps_lng = pos.coords.longitude;
        } catch (e) {
            console.warn("GPS", e);
            if (!confirm("GPS location was not found. Save without location?")) return;
        }
    }

    try {
        await sbAddActivity({
            shop_id: session.shopId,
            agent_id: session.userId || session.username || "unknown",
            customer_id: customerId,
            activity_type: type,
            outcome: outcome,
            notes: notes,
            gps_lat: gps_lat,
            gps_lng: gps_lng
        });
        alert("Activity saved.");
        if (document.getElementById("actNotes")) document.getElementById("actNotes").value = "";
        await loadActivityTable();
    } catch (e) {
        alert("Save failed: " + (e.message || e));
    }
}

async function loadActivityTable() {
    const tbody = document.getElementById("activityBody");
    if (!tbody) return;
    const session = getSession();
    tbody.innerHTML = "<tr><td colspan='6'>Loading…</td></tr>";
    try {
        if ((!customers || !customers.length) && typeof reloadAllData === "function") await reloadAllData();
        const list = await sbGetActivities(session.shopId, 100);
        if (!list.length) {
            tbody.innerHTML = "<tr><td colspan='6'>No activity yet</td></tr>";
            return;
        }
        tbody.innerHTML = list.map((a, i) => {
            const cust = (customers || []).find(c => String(c.id) === String(a.customer_id));
            const name = cust ? cust.name : "—";
            const when = (a.created_at || "").toString().slice(0, 19).replace("T", " ");
            const gps = (a.gps_lat != null && a.gps_lng != null)
                ? ("📍 " + Number(a.gps_lat).toFixed(4) + ", " + Number(a.gps_lng).toFixed(4))
                : "—";
            return `<tr>
              <td>${i + 1}</td>
              <td>${when}</td>
              <td>${name}</td>
              <td>${a.activity_type || ""}</td>
              <td>${(a.outcome || "") + (a.notes ? (" — " + a.notes) : "")}</td>
              <td>${gps}</td>
            </tr>`;
        }).join("");
    } catch (e) {
        tbody.innerHTML = "<tr><td colspan='6'>Error: " + (e.message || e) + "</td></tr>";
    }
}

async function fillActivityCustomers() {
    const sel = document.getElementById("actCustomer");
    if (!sel) return;
    if ((!customers || !customers.length) && typeof reloadAllData === "function") await reloadAllData();
    sel.innerHTML = '<option value="">Select customer</option>' +
        (customers || []).map(c => `<option value="${c.id}">${c.name || ""} (₹${Number(c.outstanding || 0).toLocaleString("en-IN")})</option>`).join("");
}

async function initActivityPage() {
    if (!document.getElementById("activityBody")) return;
    await fillActivityCustomers();
    await loadActivityTable();
}

function openLegalNoticeForCustomer(index) {
    const c = customers[index];
    if (!c) return;
    const shop = (getSession().shopName) || "Shop";
    const amt = Number(c.outstanding || 0);
    const today = new Date().toLocaleDateString("en-IN");
    const due = (c.dueDate || c.followup || "—").toString().slice(0, 10);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Legal Notice</title>
    <style>
      body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:24px;line-height:1.5;color:#111}
      h1{font-size:20px;text-align:center;text-transform:uppercase;letter-spacing:.04em}
      .meta{text-align:right;font-size:13px;color:#444}
      .box{border:1px solid #333;padding:16px;margin:20px 0}
      @media print{button{display:none}}
    </style></head><body>
    <div class="meta">${shop}<br>Date: ${today}</div>
    <h1>Payment Reminder / Legal Notice</h1>
    <p>To,<br><strong>${c.name || ""}</strong><br>
    ${c.address || c.village || ""}<br>
    Mobile: ${c.mobile || "—"}</p>
    <p>Subject: <strong>Outstanding dues – ₹${amt.toLocaleString("en-IN")}</strong></p>
    <div class="box">
      <p>This is to inform you that an amount of <strong>₹${amt.toLocaleString("en-IN")}</strong>
      is outstanding against your account. Due / follow-up reference: <strong>${due}</strong>.</p>
      <p>You are requested to clear the dues within <strong>7 days</strong> of this notice.
      Failing which, further recovery / legal steps may be initiated as per applicable law and shop policy.</p>
    </div>
    <p>This notice is issued without prejudice to other rights and remedies available.</p>
    <p style="margin-top:40px;">For ${shop}<br><br>__________________<br>Authorized Signatory</p>
    <button onclick="window.print()">Print</button>
    </body></html>`;
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) { alert("Popup blocked"); return; }
    w.document.write(html);
    w.document.close();

    // best-effort log
    (async () => {
        try {
            const session = getSession();
            if (session.shopId && c.id) {
                await sbSaveLegalNotice({
                    shop_id: session.shopId,
                    customer_id: c.id,
                    notice_type: amt > 0 && (typeof getCustomerAgingBucket === "function" && getCustomerAgingBucket(c) === "90+")
                        ? "legal_notice_1" : "reminder_letter",
                    amount_at_issue: amt,
                    sent_via: "print",
                    created_by: session.userId,
                    notes: "Printed from app"
                });
            }
        } catch (e) { console.warn("legal notice log", e); }
    })();
}

function computeAnalyticsStats() {
    const list = customers || [];
    const recs = recoveries || [];
    const totalOut = list.reduce((s, c) => s + Number(c.outstanding || 0), 0);
    const totalBill = list.reduce((s, c) => s + Number(c.bill || 0), 0);
    const totalRecovered = recs.reduce((s, r) => s + Number(r.amount || 0), 0);
    const recoveryPct = totalBill > 0 ? (totalRecovered / totalBill) * 100 : 0;
    // Simple DSO proxy: outstanding / (recovered last 30d / 30)
    const today = new Date();
    const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
    const rec30 = recs.filter(r => {
        const d = new Date(r.date || r.recovery_date || 0);
        return !isNaN(d) && d >= d30;
    }).reduce((s, r) => s + Number(r.amount || 0), 0);
    const daily = rec30 / 30;
    const dso = daily > 0 ? (totalOut / daily) : (totalOut > 0 ? 999 : 0);

    // Agent performance by executive field
    const byExec = {};
    list.forEach(c => {
        const e = (c.executive || "Unassigned").trim() || "Unassigned";
        if (!byExec[e]) byExec[e] = { name: e, customers: 0, outstanding: 0 };
        byExec[e].customers++;
        byExec[e].outstanding += Number(c.outstanding || 0);
    });
    recs.forEach(r => {
        const cust = list.find(c => String(c.id) === String(r.customerId || r.customer_id));
        const e = (cust && cust.executive) ? cust.executive : "Unassigned";
        if (!byExec[e]) byExec[e] = { name: e, customers: 0, outstanding: 0, recovered: 0 };
        byExec[e].recovered = (byExec[e].recovered || 0) + Number(r.amount || 0);
    });
    const agents = Object.values(byExec).map(a => ({
        name: a.name,
        customers: a.customers || 0,
        outstanding: a.outstanding || 0,
        recovered: a.recovered || 0
    })).sort((a, b) => b.recovered - a.recovered);

    return {
        totalOut, totalBill, totalRecovered, recoveryPct, dso, rec30, agents
    };
}

function renderAnalyticsOnReports() {
    const box = document.getElementById("analyticsCards");
    if (!box) return;
    const s = computeAnalyticsStats();
    const fmt = n => "₹" + Number(n || 0).toLocaleString("en-IN");
    box.innerHTML = `
      <div class="card green"><i class="fa-solid fa-percent"></i><h3>Recovery %</h3>
        <h1>${s.recoveryPct.toFixed(1)}%</h1><small>Recovered vs bill</small></div>
      <div class="card"><i class="fa-solid fa-calendar-days"></i><h3>DSO (proxy)</h3>
        <h1>${Math.min(999, Math.round(s.dso))}</h1><small>Days sales outstanding</small></div>
      <div class="card orange"><i class="fa-solid fa-wallet"></i><h3>30-day collection</h3>
        <h1>${fmt(s.rec30)}</h1><small>Last 30 days recovery</small></div>
      <div class="card"><i class="fa-solid fa-indian-rupee-sign"></i><h3>Total recovered</h3>
        <h1>${fmt(s.totalRecovered)}</h1><small>All time in app</small></div>
    `;
    const tbody = document.getElementById("agentPerfBody");
    if (tbody) {
        if (!s.agents.length) {
            tbody.innerHTML = "<tr><td colspan='4'>No data</td></tr>";
        } else {
            tbody.innerHTML = s.agents.map((a, i) =>
                `<tr><td>${i + 1}</td><td>${a.name}</td><td>${a.customers}</td>
                 <td>${fmt(a.recovered)}</td><td>${fmt(a.outstanding)}</td></tr>`
            ).join("");
        }
    }
}

// enhance loadReports
const _origLoadReports = typeof loadReports === "function" ? loadReports : null;
async function loadReportsEnhanced() {
    if (_origLoadReports) _origLoadReports();
    else if (typeof loadReports === "function") { /* circular guard */ }
    renderAnalyticsOnReports();
}

// Wrap: call analytics after existing loadReports if we patch callers
window.saveActivityForm = saveActivityForm;
window.loadActivityTable = loadActivityTable;
window.initActivityPage = initActivityPage;
window.openLegalNoticeForCustomer = openLegalNoticeForCustomer;
window.computeAnalyticsStats = computeAnalyticsStats;
window.renderAnalyticsOnReports = renderAnalyticsOnReports;

// ================================
// Field Employee Tracking
// ================================
async function initFieldTrackingPage() {
    if (!document.getElementById("fieldAgentBody")) return;
    await loadFieldTracking();
    if (typeof loadEmployeeLinkGenerator === "function") await loadEmployeeLinkGenerator();
}

async function loadFieldTracking() {
    const session = (typeof getSession === "function") ? getSession() : {};
    const shopId = session.shopId;
    const tbody = document.getElementById("fieldAgentBody");
    const actBody = document.getElementById("fieldTodayBody");
    if (!tbody) return;

    tbody.innerHTML = "<tr><td colspan='6'>Loading…</td></tr>";
    if (actBody) actBody.innerHTML = "<tr><td colspan='6'>Loading…</td></tr>";

    try {
        if (typeof reloadAllData === "function" && (!customers || !customers.length)) {
            await reloadAllData();
        }
        let users = [];
        try {
            users = typeof sbGetUsers === "function" ? await sbGetUsers(shopId) : [];
        } catch (e) {
            console.warn(e);
            users = [];
        }
        // Field agents: flagged OR role user/admin with activity
        const execNames = (typeof getExecutivesList === "function")
            ? getExecutivesList()
            : ((settings && settings.executives) || []);

        const activities = typeof sbGetActivities === "function"
            ? await sbGetActivities(shopId, 500)
            : [];

        const today = new Date().toISOString().slice(0, 10);

        // Build agent rows from users + executives
        const agentMap = {};
        (users || []).forEach(u => {
            const key = String(u.id);
            agentMap[key] = {
                id: u.id,
                key: key,
                name: u.display_name || u.username,
                username: u.username,
                isField: u.is_field_agent === true,
                mobile: u.mobile || "",
                assigned: 0,
                todayActs: 0,
                lastGps: null,
                lastAt: null,
                path: []
            };
        });
        // Also track by executive name string (customers.executive)
        (execNames || []).forEach(name => {
            const k = "exec:" + name;
            if (!Object.values(agentMap).some(a => a.name === name)) {
                agentMap[k] = {
                    id: null,
                    key: k,
                    name: name,
                    username: "—",
                    isField: true,
                    mobile: "",
                    assigned: 0,
                    todayActs: 0,
                    lastGps: null,
                    lastAt: null
                };
            }
        });

        (customers || []).forEach(c => {
            const exec = (c.executive || "").trim();
            if (!exec) return;
            let row = Object.values(agentMap).find(a => a.name === exec);
            if (!row) {
                const k = "exec:" + exec;
                agentMap[k] = {
                    id: null, key: k, name: exec, username: "—", isField: true,
                    mobile: "", assigned: 0, todayActs: 0, lastGps: null, lastAt: null
                };
                row = agentMap[k];
            }
            row.assigned++;
        });

        (activities || []).forEach(a => {
            const when = (a.created_at || "").toString();
            const isToday = when.slice(0, 10) === today;
            const agentKey = String(a.agent_id || "");
            let row = agentMap[agentKey];
            if (!row) {
                // match display name
                row = Object.values(agentMap).find(x => String(x.id) === agentKey || x.username === agentKey);
            }
            if (!row) {
                agentMap["id:" + agentKey] = {
                    id: agentKey, key: "id:" + agentKey, name: agentKey, username: agentKey,
                    isField: true, mobile: "", assigned: 0, todayActs: 0, lastGps: null, lastAt: null
                };
                row = agentMap["id:" + agentKey];
            }
            if (isToday) row.todayActs++;
            if (a.gps_lat != null && a.gps_lng != null) {
                if (!row.path) row.path = [];
                const custN = (customers || []).find(c => String(c.id) === String(a.customer_id));
                row.path.push({
                    lat: Number(a.gps_lat),
                    lng: Number(a.gps_lng),
                    at: when,
                    type: a.activity_type || "visit",
                    notes: a.notes || "",
                    customer: custN ? custN.name : "",
                    customer_id: a.customer_id
                });
                if (!row.lastAt || when > row.lastAt) {
                    row.lastAt = when;
                    row.lastGps = { lat: a.gps_lat, lng: a.gps_lng };
                }
            } else if (!row.lastAt || when > (row.lastAt || "")) {
                row.lastAt = when;
            }
        });

        const agents = Object.values(agentMap).filter(a =>
            a.isField || a.assigned > 0 || a.todayActs > 0 || a.lastAt
        );
        agents.sort((a, b) => b.todayActs - a.todayActs || b.assigned - a.assigned);

        const setN = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
        setN("fieldCountAgents", agents.length);
        setN("fieldCountToday", activities.filter(a => (a.created_at || "").toString().slice(0, 10) === today).length);
        setN("fieldCountAssigned", (customers || []).filter(c => c.executive).length);
        setN("fieldCountGps", activities.filter(a => a.gps_lat != null && (a.created_at || "").toString().slice(0, 10) === today).length);

        if (!agents.length) {
            tbody.innerHTML = "<tr><td colspan='6'>No field employees found. Add an Executive in Settings or assign a user as a field agent.</td></tr>";
        } else {
            tbody.innerHTML = agents.map((a, i) => {
                if (a.path && a.path.length) {
                    a.path.sort((x, y) => String(x.at).localeCompare(String(y.at)));
                }
                const stops = (a.path && a.path.length) ? a.path.length : 0;
                const pathJson = JSON.stringify(a.path || []).replace(/'/g, "&#39;");
                const nameJson = JSON.stringify(a.name || "");
                const gps = stops
                    ? `<button type="button" class="add-btn" style="padding:5px 8px;font-size:11px;" onclick='showEmployeePath(${nameJson}, ${JSON.stringify(a.path)})'>📍 ${stops} places</button>`
                    : (a.lastGps
                        ? `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${a.lastGps.lat},${a.lastGps.lng}">📍 Last</a>`
                        : "—");
                const hist = `<button type="button" class="add-btn" style="padding:5px 8px;font-size:11px;background:#0ea5e9;" onclick="showEmployeeMovementHistory('${String(a.id || a.key).replace(/'/g,"")}','${String(a.name || "").replace(/'/g,"")}')">All history</button>`;
                const last = a.lastAt ? a.lastAt.slice(0, 16).replace("T", " ") : "—";
                return `<tr>
                  <td>${i + 1}</td>
                  <td><strong>${a.name}</strong><br><small style="color:#64748b">${a.username}</small></td>
                  <td>${a.assigned}</td>
                  <td>${a.todayActs}</td>
                  <td>${last}</td>
                  <td style="white-space:nowrap;">${gps} ${hist}</td>
                </tr>`;
            }).join("");
        }

        // Today activity detail
        if (actBody) {
            const todayActs = activities.filter(a => (a.created_at || "").toString().slice(0, 10) === today);
            if (!todayActs.length) {
                actBody.innerHTML = "<tr><td colspan='6'>No field activity today.</td></tr>";
            } else {
                actBody.innerHTML = todayActs.map((a, i) => {
                    const cust = (customers || []).find(c => String(c.id) === String(a.customer_id));
                    const gps = (a.gps_lat != null)
                        ? `<a target="_blank" href="https://maps.google.com/?q=${a.gps_lat},${a.gps_lng}">📍</a>`
                        : "—";
                    return `<tr>
                      <td>${i + 1}</td>
                      <td>${(a.created_at || "").toString().slice(11, 16)}</td>
                      <td>${a.agent_id || "—"}</td>
                      <td>${cust ? cust.name : "—"}</td>
                      <td>${a.activity_type || ""} / ${a.outcome || ""} ${a.notes || ""}</td>
                      <td>${gps}</td>
                    </tr>`;
                }).join("");
            }
        }

        // Fill check-in customer dropdown
        const sel = document.getElementById("fieldCheckinCustomer");
        if (sel) {
            sel.innerHTML = '<option value="">Select customer</option>' +
                (customers || []).slice().sort((a, b) => Number(b.outstanding || 0) - Number(a.outstanding || 0))
                    .map(c => `<option value="${c.id}">${c.name} (₹${Number(c.outstanding || 0).toLocaleString("en-IN")})</option>`)
                    .join("");
        }
    } catch (e) {
        console.error(e);
        tbody.innerHTML = "<tr><td colspan='6'>Error: " + (e.message || e) + "</td></tr>";
    }
}

async function fieldCheckIn() {
    const customerId = (document.getElementById("fieldCheckinCustomer") || {}).value;
    const notes = ((document.getElementById("fieldCheckinNotes") || {}).value || "").trim();
    const type = (document.getElementById("fieldCheckinType") || {}).value || "visit";
    if (!customerId) { alert("Please select a customer."); return; }
    const session = getSession();
    if (!session.shopId) { alert("Shop login is required"); return; }

    let gps_lat = null, gps_lng = null;
    try {
        const pos = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error("GPS not available"));
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000 });
        });
        gps_lat = pos.coords.latitude;
        gps_lng = pos.coords.longitude;
    } catch (e) {
        if (!confirm("GPS location was not found. Check in without location?")) return;
    }

    try {
        await sbAddActivity({
            shop_id: session.shopId,
            agent_id: session.userId || session.username || "unknown",
            customer_id: customerId,
            activity_type: type,
            outcome: "field_checkin",
            notes: notes || "Field check-in",
            gps_lat: gps_lat,
            gps_lng: gps_lng
        });
        alert("Check-in saved." + (gps_lat != null ? "\nGPS captured." : ""));
        if (document.getElementById("fieldCheckinNotes")) document.getElementById("fieldCheckinNotes").value = "";
        await loadFieldTracking();
    } catch (e) {
        alert("Failed: " + (e.message || e));
    }
}

window.initFieldTrackingPage = initFieldTrackingPage;
window.loadFieldTracking = loadFieldTracking;
window.fieldCheckIn = fieldCheckIn;

// ================================
// Generate employee check-in links
// ================================
function getPublicCheckinBaseUrl() {
    try {
        return new URL("checkin.html", window.location.href).href.split("?")[0];
    } catch (e) {
        return "checkin.html";
    }
}

function buildEmployeeCheckinLink(agentCode) {
    const base = getPublicCheckinBaseUrl();
    if (!agentCode) return base;
    return base + "?code=" + encodeURIComponent(String(agentCode).trim());
}

async function loadEmployeeLinkGenerator() {
    const tbody = document.getElementById("empLinkBody");
    if (!tbody) return;
    const session = getSession();
    if (!session.shopId && session.role !== "super_admin") {
        tbody.innerHTML = "<tr><td colspan='5'>Shop login required</td></tr>";
        return;
    }
    tbody.innerHTML = "<tr><td colspan='5'>Loading…</td></tr>";
    try {
        const users = await sbGetUsers(session.shopId);
        const list = (users || []).filter(u => u.role !== "super_admin");
        if (!list.length) {
            tbody.innerHTML = "<tr><td colspan='5'>No users found. Add a user in Settings or Company Management.</td></tr>";
            return;
        }
        tbody.innerHTML = list.map((u, i) => {
            const code = u.agent_code || "";
            const pin = u.field_pin ? "••••" : "— not set —";
            const link = code ? buildEmployeeCheckinLink(code) : "";
            const id = u.id;
            return `<tr>
              <td>${i + 1}</td>
              <td><strong>${u.display_name || u.username}</strong><br><small>${u.username}</small></td>
              <td>
                <input type="text" id="code_${id}" value="${code.replace(/"/g, "&quot;")}" placeholder="e.g. MUKESH01" style="width:110px;padding:6px;">
              </td>
              <td>
                <input type="text" id="pin_${id}" value="${(u.field_pin || "").replace(/"/g, "&quot;")}" placeholder="PIN" style="width:90px;padding:6px;" autocomplete="off">
              </td>
              <td style="white-space:nowrap;">
                <button type="button" class="add-btn" style="padding:6px 10px;font-size:12px;" onclick="saveAgentCheckinCreds('${id}')">Save</button>
                <button type="button" class="add-btn" style="padding:6px 10px;font-size:12px;background:#16a34a;" onclick="copyAgentCheckinLink('${id}')" ${code ? "" : "disabled"}>Copy link</button>
                <button type="button" class="add-btn" style="padding:6px 10px;font-size:12px;background:#128C7E;" onclick="shareAgentCheckinWa('${id}')" ${code ? "" : "disabled"}>WA</button>
              </td>
            </tr>`;
        }).join("");
    } catch (e) {
        console.error(e);
        tbody.innerHTML = "<tr><td colspan='5'>Error: " + (e.message || e) + "</td></tr>";
    }
}

async function saveAgentCheckinCreds(userId) {
    const codeEl = document.getElementById("code_" + userId);
    const pinEl = document.getElementById("pin_" + userId);
    const code = (codeEl && codeEl.value || "").trim();
    const pin = (pinEl && pinEl.value || "").trim();
    if (!code) { alert("Agent code required"); return; }
    if (!pin || pin.length < 4) { alert("PIN minimum 4 characters"); return; }
    try {
        const sb = getSupabase();
        const { error } = await sb.from("users").update({
            agent_code: code,
            field_pin: pin,
            is_field_agent: true
        }).eq("id", userId);
        if (error) throw error;
        alert("Saved.\n\nLink:\n" + buildEmployeeCheckinLink(code));
        await loadEmployeeLinkGenerator();
        if (typeof loadFieldTracking === "function") loadFieldTracking();
    } catch (e) {
        alert("Save failed: " + (e.message || e));
    }
}

function copyAgentCheckinLink(userId) {
    const codeEl = document.getElementById("code_" + userId);
    const code = (codeEl && codeEl.value || "").trim();
    if (!code) { alert("Please save the agent code first."); return; }
    const link = buildEmployeeCheckinLink(code);
    if (navigator.clipboard) navigator.clipboard.writeText(link);
    else prompt("Copy link", link);
    alert("Link copied:\n" + link);
}

function shareAgentCheckinWa(userId) {
    const codeEl = document.getElementById("code_" + userId);
    const pinEl = document.getElementById("pin_" + userId);
    const code = (codeEl && codeEl.value || "").trim();
    const pin = (pinEl && pinEl.value || "").trim();
    if (!code) { alert("Agent code required"); return; }
    const link = buildEmployeeCheckinLink(code);
    const text =
        "Recountix — Field Check-in\n\n" +
        "Link: " + link + "\n" +
        "Agent code: " + code + "\n" +
        (pin ? ("PIN: " + pin + "\n") : "") +
        "\nNo app login is required. Please allow location access.";
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
}

window.getPublicCheckinBaseUrl = getPublicCheckinBaseUrl;
window.buildEmployeeCheckinLink = buildEmployeeCheckinLink;
window.loadEmployeeLinkGenerator = loadEmployeeLinkGenerator;
window.saveAgentCheckinCreds = saveAgentCheckinCreds;
window.copyAgentCheckinLink = copyAgentCheckinLink;
window.shareAgentCheckinWa = shareAgentCheckinWa;

function googleMapsDirUrl(path) {
    if (!path || !path.length) return "";
    const pts = path.filter(p => p.lat != null && p.lng != null);
    if (!pts.length) return "";
    if (pts.length === 1) {
        return "https://maps.google.com/?q=" + pts[0].lat + "," + pts[0].lng;
    }
    // Directions API-style URL: origin / destination / waypoints
    const origin = pts[0].lat + "," + pts[0].lng;
    const dest = pts[pts.length - 1].lat + "," + pts[pts.length - 1].lng;
    let url = "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(origin) +
        "&destination=" + encodeURIComponent(dest) + "&travelmode=driving";
    if (pts.length > 2) {
        const mids = pts.slice(1, -1).map(p => p.lat + "," + p.lng);
        // Google allows limited waypoints in URL
        const limited = mids.slice(0, 8);
        url += "&waypoints=" + encodeURIComponent(limited.join("|"));
    }
    return url;
}

function showEmployeePath(name, path) {
    const panel = document.getElementById("employeePathPanel");
    const title = document.getElementById("employeePathTitle");
    const body = document.getElementById("employeePathBody");
    const mapBtn = document.getElementById("employeePathMapBtn");
    if (!panel || !body) {
        alert((name || "Employee") + ": " + (path && path.length ? path.length + " GPS stops" : "No GPS path"));
        return;
    }
    const list = Array.isArray(path) ? path.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))) : [];
    if (title) title.textContent = (name || "Employee") + " — places visited (" + list.length + ")";
    if (!list.length) {
        body.innerHTML = "<tr><td colspan='5'>No GPS stops found — a check-in with location is required.</td></tr>";
    } else {
        body.innerHTML = list.map((p, i) => {
            const t = (p.at || "").toString().slice(0, 16).replace("T", " ");
            const map = `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${p.lat},${p.lng}">📍 Open</a>`;
            return `<tr>
              <td>${i + 1}</td>
              <td>${t}</td>
              <td>${p.customer || "—"}</td>
              <td>${p.type || ""} ${p.notes ? ("— " + p.notes) : ""}</td>
              <td>${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)} ${map}</td>
            </tr>`;
        }).join("");
    }
    if (mapBtn) {
        const url = googleMapsDirUrl(list);
        mapBtn.style.display = url ? "inline-flex" : "none";
        mapBtn.onclick = function () { if (url) window.open(url, "_blank"); };
    }
    panel.style.display = "block";
    try { panel.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
}

window.showEmployeePath = showEmployeePath;
window.googleMapsDirUrl = googleMapsDirUrl;

// ================================
// Employee movement history (where they went)
// ================================
async function showEmployeeMovementHistory(agentKey, agentLabel) {
    const panel = document.getElementById("movementHistoryPanel");
    const title = document.getElementById("movementHistoryTitle");
    const tbody = document.getElementById("movementHistoryBody");
    const mapLinks = document.getElementById("movementMapLinks");
    if (!tbody) return;

    if (panel) panel.style.display = "block";
    if (title) title.textContent = "Movement: " + (agentLabel || agentKey || "Employee");
    tbody.innerHTML = "<tr><td colspan='5'>Loading…</td></tr>";
    if (mapLinks) mapLinks.innerHTML = "";

    try {
        const session = getSession();
        const activities = typeof sbGetActivities === "function"
            ? await sbGetActivities(session.shopId, 300)
            : [];

        // Match agent_id to this employee (id or username or name)
        const key = String(agentKey || "");
        const label = String(agentLabel || "");
        let list = activities.filter(a => {
            const aid = String(a.agent_id || "");
            return aid === key || aid === label || (label && aid.indexOf(label) >= 0);
        });
        // Only with GPS = actual places visited
        const withGps = list.filter(a => a.gps_lat != null && a.gps_lng != null);
        // Show all activity but highlight GPS
        list = list.slice(0, 50);

        if (!list.length) {
            tbody.innerHTML = "<tr><td colspan='5'>This employee has no check-in activity.</td></tr>";
            return;
        }

        if ((!customers || !customers.length) && typeof reloadAllData === "function") {
            await reloadAllData();
        }

        tbody.innerHTML = list.map((a, i) => {
            const cust = (customers || []).find(c => String(c.id) === String(a.customer_id));
            const when = (a.created_at || "").toString().slice(0, 16).replace("T", " ");
            const place = (a.gps_lat != null)
                ? (`<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${a.gps_lat},${a.gps_lng}">📍 ${Number(a.gps_lat).toFixed(4)}, ${Number(a.gps_lng).toFixed(4)}</a>`)
                : "— no GPS —";
            return `<tr>
              <td>${i + 1}</td>
              <td>${when}</td>
              <td>${cust ? cust.name : "—"}</td>
              <td>${a.activity_type || ""} ${a.notes ? ("· " + a.notes) : ""}</td>
              <td>${place}</td>
            </tr>`;
        }).join("");

        // Multi-stop map: path of GPS points (Google maps dir approx via first-last or list)
        if (mapLinks && withGps.length) {
            const pts = withGps.slice().reverse(); // chronological
            let html = "<strong>Places visited (GPS):</strong> ";
            html += pts.map((a, i) => {
                const cust = (customers || []).find(c => String(c.id) === String(a.customer_id));
                const label = (cust && cust.name) || ("Stop " + (i + 1));
                return `<a target="_blank" rel="noopener" style="margin-right:8px;" href="https://maps.google.com/?q=${a.gps_lat},${a.gps_lng}">${i + 1}. ${label}</a>`;
            }).join(" ");
            if (pts.length >= 2) {
                // Google directions multi-stop limited — use path URL with | separators for search
                const path = pts.map(p => p.gps_lat + "," + p.gps_lng).join("/");
                html += `<br><a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/${path}"><i class="fa-solid fa-route"></i> Open route on Google Maps</a>`;
            }
            mapLinks.innerHTML = html;
        } else if (mapLinks) {
            mapLinks.innerHTML = "<span style='color:#64748b'>No GPS-enabled check-ins found — the places map cannot be generated.</span>";
        }

        try { panel.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
    } catch (e) {
        tbody.innerHTML = "<tr><td colspan='5'>Error: " + (e.message || e) + "</td></tr>";
    }
}

window.showEmployeeMovementHistory = showEmployeeMovementHistory;

function enforceSuperAdminDataPrivacy() {
    const session = (typeof getSession === "function") ? getSession() : {};
    if (session.role !== "super_admin") return;
    // Super admin without impersonated shop: block sensitive lists
    if (session.shopId) return;

    const sensitive = ["customerBody", "recoveryBody", "reportBody", "ptpTableBody", "escTableBody", "activityBody", "fieldAgentBody"];
    const onSensitive = sensitive.some(id => document.getElementById(id));
    if (!onSensitive) return;

    // Ensure arrays empty
    try {
        if (typeof customers !== "undefined") customers = [];
        if (typeof recoveries !== "undefined") recoveries = [];
    } catch (e) {}

    let banner = document.getElementById("saPrivacyBanner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "saPrivacyBanner";
        banner.style.cssText = "margin:12px 16px;padding:14px 16px;background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;color:#92400e;font-size:14px;line-height:1.45;";
        banner.innerHTML = "<strong>Privacy:</strong> Super Admin cannot view other jewellers' customer / recovery data. " +
            "Use <a href='super-dashboard.html'>Super Dashboard</a> for shops only. " +
            "Shop-level data is only for that shop's Admin / Staff login.";
        const main = document.querySelector(".main-content") || document.body;
        main.insertBefore(banner, main.firstChild);
    }
}

window.enforceSuperAdminDataPrivacy = enforceSuperAdminDataPrivacy;


window.getCustomerDaysOverdue = getCustomerDaysOverdue;
window.buildClientAgingSummary = buildClientAgingSummary;
