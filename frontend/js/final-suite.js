/* Recountix dark recovery shell bootstrap */
(function(){
'use strict';
function hasAsset(part){
  return Array.prototype.some.call(document.querySelectorAll('link[href],script[src]'),function(el){
    return ((el.getAttribute('href')||el.getAttribute('src')||'').indexOf(part)>-1);
  });
}
function once(id,tag,attrs){
  if(document.getElementById(id) || (attrs.href&&hasAsset(attrs.href.split('?')[0])) || (attrs.src&&hasAsset(attrs.src.split('?')[0]))) return;
  var el=document.createElement(tag);
  el.id=id;
  Object.keys(attrs).forEach(function(k){el.setAttribute(k,attrs[k]);});
  document.head.appendChild(el);
}
once('rxBoltiseDarkTheme','link',{rel:'stylesheet',href:'css/boltise-dark.css?v=navy-cards-20261009'});
if(/dashboard|customers|recovery|ptp|reports|escalations/i.test(location.pathname)){
  once('rxRecoveryComplianceScript','script',{src:'js/recovery-compliance.js?v=command-center-1',defer:'defer'});
}
var meta=document.querySelector('meta[name="theme-color"]');
if(meta) meta.setAttribute('content','#0B0F17');
document.documentElement.classList.add('rx-dark-shell');
})();

/* Recountix – Final Combined Suite */
(function(){
'use strict';
const money=n=>'₹'+Number(n||0).toLocaleString('en-IN');
const day=()=>new Date().toISOString().slice(0,10);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function session(){try{return typeof getSession==='function'?getSession():{role:'user'}}catch(e){return{role:'user'}}}
function toast(title,msg){let st=document.querySelector('.vo-toast-stack');if(!st){st=document.createElement('div');st.className='vo-toast-stack';document.body.appendChild(st)}const t=document.createElement('div');t.className='vo-toast';t.innerHTML='<b>'+esc(title)+'</b><small>'+esc(msg||'')+'</small>';st.appendChild(t);setTimeout(()=>t.remove(),4200)}
window.voToast=toast;
function nums(m){return String(m||'').replace(/\D/g,'').slice(-10)}
function waUrl(c){const m=nums(c.mobile);const text=`Hello ${c.name||''}, your pending amount is ${money(c.outstanding)}. Please contact us regarding payment or follow-up.`;return m?'https://wa.me/91'+m+'?text='+encodeURIComponent(text):'#'}
function applyRoleUI(){const role=String(session().role||'user').toLowerCase();document.body.dataset.role=role;document.querySelectorAll('.menu a').forEach(a=>{const h=(a.getAttribute('href')||'').toLowerCase();if((role==='user'||role==='agent'||role==='field_agent')&&((h.includes('settings.html')&&!(window.rxCan&&rxCan('settings')))||h.includes('companies.html')||h.includes('subscription.html')))a.closest('li')?.classList.add('vo-role-hidden')});}
function metrics(){const list=(typeof customers!=='undefined'&&Array.isArray(customers))?customers:[];const rec=(typeof recoveries!=='undefined'&&Array.isArray(recoveries))?recoveries:[];const t=day();let overdue=0,follow=0,out=0;list.forEach(c=>{out+=Number(c.outstanding||0);const f=String(c.followup||c.dueDate||'').slice(0,10);if(f===t)follow++;if(f&&f<t&&Number(c.outstanding||0)>0)overdue++});let recovered=rec.filter(r=>String(r.date||r.recovery_date||'').slice(0,10)===t).reduce((a,r)=>a+Number(r.amount||0),0);return{list,rec,t,overdue,follow,out,recovered}}
async function ptpMetrics(){try{if(typeof sbGetPtp!=='function')return{today:0,broken:0,rows:[]};const sid=session().shopId||null;if(!sid)return{today:0,broken:0,rows:[]};const rows=await sbGetPtp(sid,'all');const t=day();return{today:rows.filter(x=>String(x.promised_date).slice(0,10)===t&&String(x.status||'open')==='open').length,broken:rows.filter(x=>String(x.promised_date).slice(0,10)<t&&String(x.status||'open')==='open').length,rows}}catch(e){return{today:0,broken:0,rows:[]}}}
async function enhanceDashboard(){if(!document.getElementById('totalCustomers'))return;const m=metrics(),p=await ptpMetrics();let k=document.getElementById('voFinalKpis');if(!k){k=document.createElement('section');k.id='voFinalKpis';k.className='vo-final-kpis';const anchor=document.querySelector('.dashboard-grid');anchor?.insertAdjacentElement('afterend',k)}k.innerHTML=`<div class="vo-final-kpi danger"><span>Overdue Accounts</span><strong>${m.overdue}</strong><small>Follow-up date already passed</small></div><div class="vo-final-kpi warn"><span>Promise to Pay Today</span><strong>${p.today}</strong><small>Commitments due today</small></div><div class="vo-final-kpi danger"><span>Missed Promises</span><strong>${p.broken}</strong><small>Open PTP past promised date</small></div>`;
let panel=document.getElementById('voTodayPanel');if(!panel){panel=document.createElement('section');panel.id='voTodayPanel';panel.className='vo-today-panel';const cmd=document.querySelector('.vo-command-strip')||k;cmd.insertAdjacentElement('afterend',panel)}
const rows=m.list.filter(c=>{const f=String(c.followup||c.dueDate||'').slice(0,10);return Number(c.outstanding||0)>0&&(f===m.t||f<m.t)}).sort((a,b)=>String(a.followup||'').localeCompare(String(b.followup||''))).slice(0,12);
panel.innerHTML=`<div class="vo-today-head"><div><h2>Today's Recovery Worklist</h2><p>Due + missed follow-ups in one place</p></div><a class="vo-mini-btn" href="customers.html">View all customers</a></div><table class="vo-today-table"><thead><tr><th>Customer</th><th>Mobile</th><th>Outstanding</th><th>Follow-up</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.length?rows.map((c,i)=>{const f=String(c.followup||c.dueDate||'').slice(0,10),late=f&&f<m.t;return `<tr><td><b>${esc(c.name)}</b><br><small>${esc(c.village||'')}</small></td><td>${esc(c.mobile||'-')}</td><td><b>${money(c.outstanding)}</b></td><td>${esc(f||'-')}</td><td><span class="vo-badge ${late?'overdue':'today'}">${late?'Overdue':'Today'}</span></td><td><div class="vo-action-row"><a class="vo-mini-btn wa" href="${waUrl(c)}" target="_blank">WhatsApp</a><a class="vo-mini-btn" href="tel:${nums(c.mobile)}">Call</a><a class="vo-mini-btn pay" href="recovery.html">Recovery</a></div></td></tr>`}).join(''):`<tr><td colspan="6" class="vo-empty">No pending follow-ups for today 🎉</td></tr>`}</tbody></table>`;
const ptpLink=[...document.querySelectorAll('.menu a')].find(a=>(a.getAttribute('href')||'').includes('ptp.html'));if(ptpLink&&p.broken>0){ptpLink.classList.add('vo-attention');ptpLink.dataset.count=p.broken}
if((!window.rxPreferences||window.rxPreferences.notifications!=='off')&&(m.overdue||p.today||p.broken)&&!window.__voNotice){window.__voNotice=1;toast('Daily Recovery Summary',`${m.overdue} overdue • ${p.today} PTP today • ${p.broken} missed promise`)}}
function ensureProfile(){if(document.getElementById('voProfile'))return;const d=document.createElement('div');d.id='voProfile';d.className='vo-profile-backdrop';d.innerHTML='<div class="vo-profile-card"><div class="vo-profile-top"><div><small>CUSTOMER PROFILE</small><h2 id="voProfileName">Customer</h2><div id="voProfileSub"></div></div><button class="vo-profile-close" type="button">×</button></div><div class="vo-profile-body" id="voProfileBody"></div></div>';document.body.appendChild(d);d.querySelector('.vo-profile-close').onclick=()=>d.classList.remove('open');d.onclick=e=>{if(e.target===d)d.classList.remove('open')}}
function showProfile(index){const c=(typeof customers!=='undefined'?customers:[])[index];if(!c)return;ensureProfile();const d=document.getElementById('voProfile');document.getElementById('voProfileName').textContent=c.name||'Customer';document.getElementById('voProfileSub').textContent=[c.mobile,c.village].filter(Boolean).join(' • ');const rr=(typeof recoveries!=='undefined'?recoveries:[]).filter(r=>String(r.customerId||r.customer_id)===String(c.id));const paid=rr.reduce((a,r)=>a+Number(r.amount||0),0);const last=rr.slice().sort((a,b)=>String(b.date||b.recovery_date||'').localeCompare(String(a.date||a.recovery_date||'')))[0];document.getElementById('voProfileBody').innerHTML=`<div class="vo-profile-grid"><div class="vo-profile-stat"><span>Total Bill</span><strong>${money(c.bill)}</strong></div><div class="vo-profile-stat"><span>Recovered</span><strong>${money(paid+Number(c.down||0))}</strong></div><div class="vo-profile-stat"><span>Outstanding</span><strong>${money(c.outstanding)}</strong></div><div class="vo-profile-stat"><span>Follow-up</span><strong>${esc(c.followup||'-')}</strong></div><div class="vo-profile-stat"><span>Last Payment</span><strong>${esc(last?(last.date||last.recovery_date):'-')}</strong></div><div class="vo-profile-stat"><span>Status</span><strong>${esc(c.status||'Active')}</strong></div></div><div class="vo-profile-info"><div><b>Father</b>${esc(c.father||'-')}</div><div><b>Executive</b>${esc(c.executive||'-')}</div><div><b>Taluka</b>${esc(c.taluka||'-')}</div><div><b>District</b>${esc(c.district||'-')}</div><div><b>Address</b>${esc(c.address||'-')}</div><div><b>Remarks</b>${esc(c.remarks||'-')}</div></div><div class="vo-profile-actions"><a href="tel:${nums(c.mobile)}">📞 Call</a><a href="${waUrl(c)}" target="_blank">💬 WhatsApp</a><a href="recovery.html">₹ Record Recovery</a><a href="ptp.html">🤝 Promise to Pay</a></div>`;d.classList.add('open')}
function upgradeCustomerView(){if(typeof window.viewCustomer==='function'&&!window.__oldViewCustomer){window.__oldViewCustomer=window.viewCustomer;window.viewCustomer=showProfile}}
function polish(){document.querySelectorAll('button').forEach(b=>{if(!b.dataset.voBusy){b.dataset.voBusy='1';b.addEventListener('click',()=>{if(b.disabled)return;b.classList.add('vo-clicked');setTimeout(()=>b.classList.remove('vo-clicked'),250)})}})}
function idle(fn,delay){setTimeout(()=>('requestIdleCallback'in window?requestIdleCallback(fn,{timeout:1600}):fn()),delay||0)}
async function run(){
  await window.rxPreferencesReady;
  applyRoleUI();
  if(document.body.dataset.rxSuiteReady==='1') return;
  document.body.dataset.rxSuiteReady='1';
  upgradeCustomerView();
  polish();
  if(document.getElementById('totalCustomers')) await enhanceDashboard();
}
window.addEventListener('load',()=>idle(run,450));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.getElementById('totalCustomers')) idle(enhanceDashboard,250)});
if(document.getElementById('totalCustomers')) setInterval(()=>{if(!document.hidden)enhanceDashboard()},60000);
})();

/* Recountix Rc.0.05 — Compact data views: overview first, details on demand */
(function(){
  'use strict';
  function makeCompact(section){
    if(!section || section.dataset.rcCompact==='1') return;
    const head=section.querySelector(':scope > .summary-bar, :scope > .vo-today-head');
    if(!head) return;
    const title=(head.querySelector('h2,h3')?.textContent||'View details').trim();
    const children=[...section.children].filter(el=>el!==head);
    if(!children.length) return;
    const body=document.createElement('div'); body.className='rc-compact-body';
    children.forEach(el=>body.appendChild(el));
    section.appendChild(body);
    const actions=document.createElement('div'); actions.className='rc-compact-actions';
    const btn=document.createElement('button'); btn.type='button'; btn.className='rc-view-details';
    btn.innerHTML='<span>View details</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
    btn.setAttribute('aria-expanded','false');
    btn.setAttribute('aria-label','Open '+title);
    actions.appendChild(btn); head.appendChild(actions);
    btn.addEventListener('click',()=>{
      const open=section.classList.toggle('rc-open');
      btn.setAttribute('aria-expanded',String(open));
      btn.querySelector('span').textContent=open?'Hide details':'View details';
      if(open) setTimeout(()=>body.scrollIntoView({behavior:'smooth',block:'nearest'}),80);
    });
    section.dataset.rcCompact='1';
  }
  function apply(){
    document.querySelectorAll('section.table-section, section.vo-today-panel').forEach(makeCompact);
  }
  window.rcApplyCompactViews=apply;
  function bootCompact(){
    if(!document.querySelector('section.table-section, section.vo-today-panel')) return;
    apply();
    const root=document.querySelector('.main-content')||document.body;
    const mo=new MutationObserver(()=>{clearTimeout(window.__rcCompactTimer);window.__rcCompactTimer=setTimeout(apply,250)});
    mo.observe(root,{childList:true,subtree:true});
    setTimeout(()=>mo.disconnect(),12000);
  }
  window.addEventListener('load',()=>('requestIdleCallback'in window?requestIdleCallback(bootCompact,{timeout:1800}):setTimeout(bootCompact,600)));
})();
