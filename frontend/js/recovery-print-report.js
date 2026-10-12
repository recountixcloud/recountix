/* Recountix clean recovery print report — customer-wise totals, promises, received amount and outstanding. */
(function () {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const money = (value) => "₹" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const dateOf = (value) => String(value || "").slice(0, 10);
  const currentDate = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const customerIdOf = (item) => String(item.customerId || item.customer_id || "");
  const customerById = (id) => ((window.customers || []).find((c) => String(c.id) === String(id)) || {});
  const dateInRange = (value, from, to) => {
    const d = dateOf(value);
    return (!from || d >= from) && (!to || d <= to);
  };

  function ensurePrintLayout() {
    const box = byId("cleanPrintReport");
    if (!box) return;
    let style = byId("rxRecoveryPrintStyles");
    if (!style) {
      style = document.createElement("style");
      style.id = "rxRecoveryPrintStyles";
      style.textContent = `
        .clean-print-report{display:none;background:#fff;color:#111;font-family:Arial,sans-serif;position:relative;isolation:isolate;overflow:hidden}
        .clean-print-report::before{content:"";position:absolute;z-index:0;pointer-events:none;left:50%;top:54%;transform:translate(-50%,-50%);width:48%;height:70%;background-image:url("assets/logo.png");background-repeat:no-repeat;background-position:center;background-size:contain;opacity:.075}
        .clean-print-report .cpr-header,.clean-print-report .cpr-table,.clean-print-report .cpr-footer{position:relative;z-index:1}
        .clean-print-report .cpr-header{text-align:center;margin-bottom:8px;background:#f0fbf8!important;border:1px solid #b8e4d8;border-top:5px solid #07866f;padding:8px 12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .clean-print-report .cpr-logo{display:block;max-height:58px;max-width:190px;width:auto;height:auto;object-fit:contain;margin:0 auto 5px}
        .clean-print-report h1{font-size:22px;margin:4px 0}
        .clean-print-report p{margin:4px 0;font-size:11px}
        .clean-print-report .cpr-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:9px;overflow-wrap:anywhere}
        .clean-print-report .cpr-table th:nth-child(1){width:3%}
        .clean-print-report .cpr-table th:nth-child(2){width:12%}
        .clean-print-report .cpr-table th:nth-child(3){width:9%}
        .clean-print-report .cpr-table th:nth-child(4){width:10%}
        .clean-print-report .cpr-table th:nth-child(5){width:16%}
        .clean-print-report .cpr-table th:nth-child(6){width:10%}
        .clean-print-report .cpr-table th:nth-child(7){width:10%}
        .clean-print-report .cpr-table th:nth-child(8){width:12%}
        .clean-print-report .cpr-table th:nth-child(9){width:9%}
        .clean-print-report .cpr-table th:nth-child(10){width:9%}
        .clean-print-report .cpr-table th,.clean-print-report .cpr-table td{border:1px solid #aab2ad;padding:6px 5px;text-align:left;vertical-align:top}
        .clean-print-report .cpr-table th{background:#edf5f0!important;font-weight:700}
        .clean-print-report .cpr-table td.amount,.clean-print-report .cpr-table th.amount{text-align:right;white-space:nowrap}
        .clean-print-report .cpr-table tbody tr:nth-child(even){background:#eef7ff!important}
        .clean-print-report .cpr-table td:nth-child(6){background:#fff8dc!important}
        .clean-print-report .cpr-table td:nth-child(7){background:#fff0e5!important}
        .clean-print-report .cpr-table td:nth-child(8){background:#e7f8ef!important}
        .clean-print-report .cpr-table td:nth-child(9){background:#eaf2ff!important}
        .clean-print-report .cpr-table td:nth-child(10){background:#ffe9e9!important}
        .clean-print-report .cpr-footer{background:#eaf7f3!important;border:1px solid #b8e4d8;padding:8px 10px}
        .clean-print-report .cpr-footer p{color:#075e52;font-weight:600}
        .clean-print-report *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .clean-print-report .cpr-footer{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 18px;margin-top:14px;padding-top:10px;border-top:2px solid #1f513f}
        .clean-print-report .cpr-footer p{font-size:12px;margin:0}
        .clean-print-report .cpr-sign{grid-column:1/-1;text-align:right;color:#555}
        @page{size:A4 landscape;margin:10mm}
        @media print{
          body.rx-print-clean *{visibility:hidden!important}
          body.rx-print-clean #cleanPrintReport,body.rx-print-clean #cleanPrintReport *{visibility:visible!important}
          body.rx-print-clean #cleanPrintReport{display:block!important;position:static!important;left:auto!important;top:auto!important;width:100%!important;margin:0!important;padding:0!important;break-after:auto!important}
          body.rx-print-clean html,body.rx-print-clean{height:auto!important;overflow:visible!important}
          body.rx-print-clean #cleanPrintReport .cpr-header{margin-bottom:8px}
          body.rx-print-clean #cleanPrintReport .cpr-table th,body.rx-print-clean #cleanPrintReport .cpr-table td{padding:4px 3px;font-size:8px;line-height:1.2;white-space:normal}
          body.rx-print-clean #cleanPrintReport .cpr-footer{margin-top:8px;break-inside:avoid}
          body.rx-print-clean .cpr-table{page-break-inside:auto}
          body.rx-print-clean .cpr-table tr{page-break-inside:avoid;page-break-after:auto}
          body.rx-print-clean .cpr-table thead{display:table-header-group}
        }`;
      document.head.appendChild(style);
    }
  }

  async function printRecoverySummary() {
    const box = byId("cleanPrintReport");
    const body = byId("cprBody");
    if (!box || !body) { window.print(); return; }
    ensurePrintLayout();

    const fromEl = byId("fromDate");
    const toEl = byId("toDate");
    const dayEl = byId("dayWiseDate");
    const searchEl = byId("reportSearch");
    const customerEl = byId("reportCustomer");
    const today = currentDate();
    const from = (fromEl && fromEl.value) || (dayEl && dayEl.value) || "";
    const to = (toEl && toEl.value) || (dayEl && dayEl.value) || "";
    const selectedCustomer = customerEl && customerEl.value ? String(customerEl.value) : "";
    const query = searchEl && searchEl.value ? searchEl.value.trim().toLowerCase() : "";
    const session = (typeof window.getSession === "function" ? window.getSession() : {}) || {};

    try {
      if (typeof window.loadReports === "function") await window.loadReports();
      else if (typeof window.reloadAllData === "function" && (!Array.isArray(window.customers) || !window.customers.length)) await window.reloadAllData();
    } catch (e) { console.warn("Could not refresh report data before printing", e); }
    const allCustomers = (typeof customers !== "undefined" && Array.isArray(customers)) ? customers.slice() : (Array.isArray(window.customers) ? window.customers.slice() : []);
    const allRecoveries = (typeof recoveries !== "undefined" && Array.isArray(recoveries)) ? recoveries.slice() : (Array.isArray(window.recoveries) ? window.recoveries.slice() : []);

    let promises = [];
    let activities = [];
    try {
      if (typeof window.sbGetPtp === "function") promises = await window.sbGetPtp(session.shopId || null, "all") || [];
    } catch (e) { console.warn("Report promise data unavailable", e); }
    try {
      if (typeof window.sbGetActivities === "function") activities = await window.sbGetActivities(session.shopId || null, 500) || [];
    } catch (e) { console.warn("Report activity data unavailable", e); }

    const filteredCustomers = allCustomers.filter((c) => {
      if (selectedCustomer && String(c.id) !== selectedCustomer) return false;
      const haystack = [c.name, c.mobile, c.village, c.city, c.district].join(" ").toLowerCase();
      return !query || haystack.includes(query);
    });

    const promiseByCustomer = {};
    promises.filter((p) => dateInRange(p.promised_date || p.created_at, from, to)).forEach((p) => {
      const id = String(p.customer_id || p.customerId || "");
      if (!id) return;
      if (!promiseByCustomer[id]) promiseByCustomer[id] = { amount: 0, details: [] };
      promiseByCustomer[id].amount += Number(p.promised_amount || p.amount || 0);
      const detail = [p.promised_date ? ("Date: " + dateOf(p.promised_date)) : "", p.notes || ""].filter(Boolean).join(" — ");
      if (detail) promiseByCustomer[id].details.push(detail);
    });

    const recoveryByCustomer = {};
    allRecoveries.filter((r) => dateInRange(r.date || r.recovery_date || r.created_at, from, to)).forEach((r) => {
      const id = customerIdOf(r);
      if (!id) return;
      recoveryByCustomer[id] = (recoveryByCustomer[id] || 0) + Number(r.amount || 0);
    });

    const latestActivityByCustomer = {};
    activities.filter((a) => dateInRange(a.created_at, from, to)).forEach((a) => {
      const id = String(a.customer_id || a.customerId || "");
      if (!id) return;
      if (!latestActivityByCustomer[id] || String(a.created_at || "") > String(latestActivityByCustomer[id].created_at || "")) {
        latestActivityByCustomer[id] = a;
      }
    });

    const rows = filteredCustomers.map((c) => {
      const id = String(c.id);
      const customerRecoveries = allRecoveries.filter((r) => customerIdOf(r) === id);
      const totalAmount = Number(c.bill || c.total_amount || c.totalAmount || (Number(c.outstanding || c.balance || 0) + customerRecoveries.reduce((sum, r) => sum + Number(r.amount || 0), 0)) || 0);
      const activity = latestActivityByCustomer[id];
      const callType = activity ? String(activity.activity_type || "Activity") : "No call logged";
      const callResult = activity ? [activity.outcome, activity.notes].filter(Boolean).join(" — ") : "";
      return {
        name: c.name || "-",
        city: c.village || c.city || c.district || "-",
        mobile: c.mobile || c.phone || "-",
        callStatus: activity ? callType + (callResult ? ": " + callResult : "") : "No call logged",
        totalAmount,
        promise: Number((promiseByCustomer[id] || {}).amount || 0),
        promiseDetails: ((promiseByCustomer[id] || {}).details || []).join(" | ") || "-",
        received: Number(recoveryByCustomer[id] || 0),
        due: Number(c.outstanding || c.balance || 0)
      };
    });

    const totals = rows.reduce((acc, r) => {
      acc.amount += r.totalAmount;
      acc.promise += r.promise;
      acc.received += r.received;
      acc.due += r.due;
      return acc;
    }, { amount: 0, promise: 0, received: 0, due: 0 });

    const headers = ["#", "Customer Name", "City / Village", "Mobile Number", "Call Status / Result", "Total Amount", "Promise Amount", "Promise Details / Date", "Received Amount", "Total Outstanding"];
    const table = box.querySelector(".cpr-table");
    if (table) {
      table.innerHTML = "<thead><tr>" + headers.map((h, i) => "<th" + (i >= 5 ? ' class="amount"' : "") + ">" + esc(h) + "</th>").join("") + "</tr></thead><tbody id=\"cprBody\"></tbody>";
    }
    const tbody = byId("cprBody");
    if (tbody) {
      tbody.innerHTML = rows.length ? rows.map((r, i) =>
        "<tr><td>" + (i + 1) + "</td><td>" + esc(r.name) + "</td><td>" + esc(r.city) + "</td><td>" + esc(r.mobile) + "</td><td>" + esc(r.callStatus) + "</td><td class=\"amount\">" + money(r.totalAmount) + "</td><td class=\"amount\">" + money(r.promise) + "</td><td>" + esc(r.promiseDetails) + "</td><td class=\"amount\">" + money(r.received) + "</td><td class=\"amount\">" + money(r.due) + "</td></tr>"
      ).join("") : '<tr><td colspan="10" style="text-align:center">No customers match these filters.</td></tr>';
    }

    const footer = box.querySelector(".cpr-footer");
    if (footer) {
      footer.innerHTML = '<p>Total Customers: <strong>' + rows.length.toLocaleString("en-IN") + '</strong></p>' +
        '<p>Total Amount: <strong>' + money(totals.amount) + '</strong></p>' +
        '<p>Total Promise Amount: <strong>' + money(totals.promise) + '</strong></p>' +
        '<p>Today\'s Recovery: <strong>' + money(totals.received) + '</strong></p>' +
        '<p>Total Outstanding: <strong>' + money(totals.due) + '</strong></p>' +
        '<p class="cpr-sign">Generated by Recountix</p>';
    }

    const shop = session.shopName || (window.settings && window.settings.company) || "Recountix";
    if (byId("cprShopName")) byId("cprShopName").textContent = shop;
    if (byId("cprSubTitle")) byId("cprSubTitle").textContent = "Customer-wise Daily Recovery Report";
    if (byId("cprDateLine")) byId("cprDateLine").textContent = "Printed: " + new Date().toLocaleString("en-IN");
    if (byId("cprFilterLine")) byId("cprFilterLine").textContent = "Period: " + (from || "All") + " to " + (to || "All") + " | Total CR not shown";
    document.body.classList.add("rx-print-clean");
    box.style.display = "block";
    try {
      window.print();
    } finally {
      setTimeout(() => {
        document.body.classList.remove("rx-print-clean");
        box.style.display = "none";
      }, 600);
    }
  }

  window.printCleanReport = printRecoverySummary;
})();
