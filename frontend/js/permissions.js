/* Server-enforced, per-user business permissions. UI state is never authorization. */
(function () {
'use strict';
let rights = {}, serverRole = '', loaded = false, refreshing = null;
const page = location.pathname.split('/').pop();
const normalizeRole = value => String(value || '').trim().toLowerCase().replace(/[ -]+/g, '_');
const manager = () => ['admin','super_admin'].includes(normalizeRole(serverRole));
function can(key) { return loaded && rights.view === true && rights[key] === true; }
async function rpc(name, args) {
 const token = getSession().sessionToken;
 if (!token) throw new Error('Please sign in again.');
 const {data,error} = await getSupabase().rpc(name, Object.assign({p_token:token},args || {}));
 if (error) throw error;
 return data;
}
async function refresh() {
 if (refreshing) return refreshing;
 refreshing = (async () => {
  const wasLoaded=loaded, previous=JSON.stringify(rights);
  try {
   const result=await rpc('app_get_my_permissions');
   rights=result && result.permissions && typeof result.permissions === 'object' ? result.permissions : {}; serverRole=normalizeRole(result && result.role); loaded=true;
   if (wasLoaded && previous!==JSON.stringify(rights)) { location.reload(); return; }
  } catch (error) { rights={};serverRole='';loaded=true;console.warn('Permissions unavailable',error.message); }
  apply();
 })();
 try { await refreshing; } finally { refreshing=null; }
}
function requireRight(key) {
 if (can(key)) return true;
 alert('You do not have permission for this action. Contact your Administrator.');
 return false;
}
const actions = {
 openModal:'add', editCustomer:'modify', deleteCustomer:'delete', saveRecovery:'add', editRecovery:'modify',deleteRecovery:'delete',
 savePtpForm:'add',markPtpKept:'modify',markPtpBroken:'modify',markPtpCancelled:'modify',runBrokenPtpCheck:'modify',
 processWhatsAppReminders:'modify',
 openPaymentLinkForCustomer:'add',openLegalNoticeForCustomer:'add',saveCompanyBranding:'settings',
 addExecutive:'settings',removeExecutive:'settings',previewCompanyLogo:'settings',saveSettings:'settings'
};
function apply() {
 document.querySelectorAll('[data-rx-right]').forEach(el => { el.hidden=!can(el.dataset.rxRight); });
 document.querySelectorAll('[onclick]').forEach(el => {
  const name=(el.getAttribute('onclick') || '').match(/^\s*([\w]+)/)?.[1];
  const key=actions[name];
  if (key) { el.classList.toggle('rx-permission-hidden',!can(key)); }
 });
 document.querySelectorAll('a[href="settings.html"]').forEach(el=>{
  const show=manager() || can('settings');el.style.display=show?'':'none';
  el.closest('li')?.classList.toggle('vo-role-hidden',!show);
 });
 const upload=document.querySelector('input[type="file"][accept*=".xlsx"]');
 if(upload) upload.disabled=!can('add');
 if (!loaded || !getSession().isLoggedIn || ['login.html','checkin.html','maintenance.html','index.html'].includes(page)) return;
 const denied=!can('view') || (page==='settings.html' && !manager() && !can('settings'));
 let block=document.getElementById('rxAccessBlocked');
 if(denied && !block) {
  block=document.createElement('div');block.id='rxAccessBlocked';block.setAttribute('role','alert');
  block.innerHTML='<div><h2>Access unavailable</h2><p>Your Administrator has not granted access, or permissions could not be verified.</p><button type="button" id="rxRetryAccess">Retry</button> <a href="dashboard.html">Dashboard</a> · <button type="button" id="rxExitAccess">Sign out</button></div>';
  document.body.append(block);block.querySelector('#rxRetryAccess').onclick=()=>location.reload();
  block.querySelector('#rxExitAccess').onclick=()=>{clearSession();location.replace('login.html');};
 } else if(!denied && block) block.remove();
}
window.RecountixPermissions={can,refresh,require:requireRight,apply};
window.rxCan=can;window.rxRequire=requireRight;
window.rxPermissionsReady=getSession().isLoggedIn && getSession().sessionToken ? refresh() : Promise.resolve();
window.addEventListener('load',()=>{
 const style=document.createElement('style');style.textContent='.rx-permission-hidden{display:none!important}#rxAccessBlocked{position:fixed;inset:0;z-index:100000;background:#f1f5f9;display:grid;place-items:center;padding:24px;color:#18344e}#rxAccessBlocked>div{max-width:440px;background:white;padding:28px;border-radius:18px}';
 document.head.append(style);apply();
 // Existing tables are rendered dynamically, so update controls after row changes.
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;apply();});}).observe(document.body,{childList:true,subtree:true});
 setInterval(()=>{if(!document.hidden && getSession().isLoggedIn)refresh();},15000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden && getSession().isLoggedIn)refresh();});
});
})();
