/* Recountix recovery compliance helpers */
(function(){
'use strict';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from, to = new Date()) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end) return 0;
  return Math.max(0, Math.floor((end.setHours(0,0,0,0) - start.setHours(0,0,0,0)) / MS_PER_DAY));
}

function calculateDelayedInterest(principal, dueDate, ratePa = 18, asOf = new Date()) {
  const overdueDays = daysBetween(dueDate, asOf);
  const amount = Number(principal || 0);
  const annualRate = Number(ratePa || 0) / 100;
  return {
    principal: amount,
    ratePa: Number(ratePa || 0),
    overdueDays,
    interestAmount: Math.max(0, amount * annualRate * overdueDays / 365)
  };
}

function msmeCountdown(invoiceDate, asOf = new Date()) {
  const elapsed = daysBetween(invoiceDate, asOf);
  const daysLeft = Math.max(0, 45 - elapsed);
  return {
    elapsed,
    daysLeft,
    status: elapsed >= 45 ? 'statutory_overdue' : elapsed >= 35 ? 'urgent' : 'within_window'
  };
}

function riskTone(daysOverdue, avgDelayDays = 0) {
  const risk = Number(daysOverdue || 0) + Math.round(Number(avgDelayDays || 0) * 0.6);
  if (risk >= 90) return { label: 'Red', className: 'risk-red' };
  if (risk >= 31) return { label: 'Yellow', className: 'risk-yellow' };
  return { label: 'Green', className: 'risk-green' };
}

function buildUpiIntent({ upiId, name = 'Recountix', amount = 0, note = 'Invoice payment' }) {
  if (!upiId) return '';
  const params = new URLSearchParams({
    pa: upiId,
    pn: name,
    am: Number(amount || 0).toFixed(2),
    cu: 'INR',
    tn: note
  });
  return 'upi://pay?' + params.toString();
}

function buildDemandLetter(customer, options = {}) {
  const dueDate = customer.dueDate || customer.due_date || customer.invoiceDueDate;
  const principal = Number(customer.balance || customer.outstanding || customer.amount || 0);
  const rate = Number(customer.interestRatePa || customer.interest_rate_pa || options.interestRatePa || 18);
  const interest = calculateDelayedInterest(principal, dueDate, rate);
  const total = principal + interest.interestAmount;
  const company = options.companyName || 'Recountix';
  const today = new Date().toLocaleDateString('en-IN');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Letter of Demand - ${esc(customer.name || customer.company || 'Customer')}</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;color:#0f172a;line-height:1.55;margin:48px}
    h1{font-size:24px;margin:0 0 24px}
    .muted{color:#64748b}
    .box{border:1px solid #cbd5e1;border-radius:12px;padding:16px;margin:20px 0}
    table{width:100%;border-collapse:collapse;margin:18px 0}
    th,td{border-bottom:1px solid #e2e8f0;text-align:left;padding:10px}
    th{background:#f8fafc}
    .total{font-size:18px;font-weight:700}
  </style>
</head>
<body>
  <p class="muted">${esc(today)}</p>
  <h1>Formal Letter of Demand</h1>
  <p>To,<br><strong>${esc(customer.name || customer.company || 'Customer')}</strong></p>
  <p>This is a formal reminder that the following payment remains outstanding beyond the agreed due date.</p>
  <div class="box">
    <table>
      <tr><th>Principal Outstanding</th><td>${money(principal)}</td></tr>
      <tr><th>Due Date</th><td>${esc(dueDate || 'Not specified')}</td></tr>
      <tr><th>Days Overdue</th><td>${interest.overdueDays}</td></tr>
      <tr><th>Delayed Payment Interest @ ${rate}% p.a.</th><td>${money(interest.interestAmount)}</td></tr>
      <tr class="total"><th>Total Payable</th><td>${money(total)}</td></tr>
    </table>
  </div>
  <p>You are requested to clear the outstanding amount immediately to avoid escalation, statutory compliance impact, or further recovery proceedings.</p>
  <p>Regards,<br><strong>${esc(company)}</strong></p>
</body>
</html>`;
}

function openDemandLetter(customer, options) {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(buildDemandLetter(customer, options));
  win.document.close();
  win.focus();
  return true;
}

window.RecountixRecoveryCompliance = {
  calculateDelayedInterest,
  msmeCountdown,
  riskTone,
  buildUpiIntent,
  buildDemandLetter,
  openDemandLetter
};
})();
