/* Server-enforced, per-user business permissions. UI state is never authorization. */
(function () {
'use strict';
const fields = [
 ['view', 'View records', 'Dashboard, customers, recovery, reports and activity'],
 ['add', 'Add records', 'New customers, collections, promises, activities and Excel import'],
 ['modify', 'Modify records', 'Edit customers, collections, follow-ups and promise status'],
 ['delete', 'Delete records', 'Delete customers, collections and supported records'],
 ['settings', 'Business settings', 'Company details and recovery executive list'],
 ['backup', 'Create / download backup', 'Export business data and open device backups'],
 ['restore', 'Restore backup', 'Restore missing business records from a backup']
];
let rights = {}, serverRole = '', loaded = false, refreshing = null, users = [], editing = null;
const page = location.pathname.split('/').pop();
const manager = () => ['admin','super_admin'].includes(serverRole);
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
   rights=result.permissions || {}; serverRole=result.role || ''; loaded=true;
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
 setEscalationStatus:'modify',saveActivityForm:'add',fieldCheckIn:'add',processWhatsAppReminders:'modify',
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
 document.querySelectorAll('a[href="backup.html"]').forEach(el=>{el.style.display=can('backup') || can('restore')?'':'none';});
 const sync=document.getElementById('syncBackup');if(sync)sync.hidden=!can('backup');
 const restore=document.getElementById('restoreBackup');if(restore)restore.hidden=!can('restore');
 const management=document.getElementById('userManagementSection');
 if (management) management.style.display=manager()?'':'none';
 const roleSelect=document.getElementById('newUserRole');
 if (roleSelect && serverRole==='admin') {roleSelect.value='User';roleSelect.disabled=true;}
 const upload=document.querySelector('input[type="file"][accept*=".xlsx"]');
 if(upload) upload.disabled=!can('add');
 if (!loaded || !getSession().isLoggedIn || ['login.html','checkin.html','maintenance.html','index.html'].includes(page)) return;
 const denied=!can('view') || (page==='settings.html' && !manager() && !can('settings')) || (page==='backup.html' && !can('backup') && !can('restore'));
 let block=document.getElementById('rxAccessBlocked');
 if(denied && !block) {
  block=document.createElement('div');block.id='rxAccessBlocked';block.setAttribute('role','alert');
  block.innerHTML='<div><h2>Access unavailable</h2><p>Your Administrator has not granted access, or permissions could not be verified.</p><button type="button" id="rxRetryAccess">Retry</button> <a href="dashboard.html">Dashboard</a> · <button type="button" id="rxExitAccess">Sign out</button></div>';
  document.body.append(block);block.querySelector('#rxRetryAccess').onclick=()=>location.reload();
  block.querySelector('#rxExitAccess').onclick=()=>{clearSession();location.replace('login.html');};
 } else if(!denied && block) block.remove();
}
function ensureDialog() {
 if(document.getElementById('rxUserAccess'))return;
 const dialog=document.createElement('dialog');dialog.id='rxUserAccess';
 dialog.innerHTML=`<form id="rxAccessForm"><h2>User rights &amp; control</h2><p id="rxAccessUser"></p>
 <div class="rx-account-fields"><label>Username<input id="rxAccessUsername" required pattern="[A-Za-z0-9._-]{3,50}" maxlength="50"></label>
 <label>Display name<input id="rxAccessName" maxlength="150"></label></div>
 <label class="rx-active"><input id="rxAccessActive" type="checkbox"> Account active</label>
 <p>Choose this user's rights across your business. User administration remains with Admin.</p>
 <div class="rx-presets"><button type="button" data-preset="all">Allow all business rights</button><button type="button" data-preset="view">View only</button><button type="button" data-preset="none">Remove all rights</button></div>
 <div class="rx-rights-grid">${fields.map(([key,title,detail])=>`<label class="rx-right"><input type="checkbox" data-right="${key}"><span><strong>${title}</strong><small>${detail}</small></span></label>`).join('')}</div>
 <p id="rxAccessError" role="alert"></p><div class="rx-dialog-actions"><button type="button" id="rxAccessCancel">Cancel</button><button type="submit" id="rxAccessSave">Save rights</button></div></form>`;
 document.body.append(dialog);
 dialog.querySelector('#rxAccessCancel').onclick=()=>dialog.close();
 dialog.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>{
  dialog.querySelectorAll('[data-right]').forEach(box=>{box.checked=button.dataset.preset==='all' || (button.dataset.preset==='view' && box.dataset.right==='view');});
 });
 dialog.addEventListener('change',event=>{
  const key=event.target.dataset.right;if(!key)return;
  if(key==='view' && !event.target.checked) dialog.querySelectorAll('[data-right]').forEach(box=>{box.checked=false;});
  else if(event.target.checked) dialog.querySelector('[data-right="view"]').checked=true;
 });
 dialog.querySelector('form').onsubmit=async event=>{
  event.preventDefault();const button=dialog.querySelector('#rxAccessSave');if(button.disabled)return;
  const permissions={};dialog.querySelectorAll('[data-right]').forEach(box=>{permissions[box.dataset.right]=box.checked;});
  const payload={username:dialog.querySelector('#rxAccessUsername').value.trim(),display_name:dialog.querySelector('#rxAccessName').value.trim(),is_active:dialog.querySelector('#rxAccessActive').checked,permissions};
  button.disabled=true;dialog.querySelector('#rxAccessError').textContent='';
  try {await rpc('app_update_user_access',{p_user_id:editing,p_payload:payload});dialog.close();await loadUsers();}
  catch(error) {dialog.querySelector('#rxAccessError').textContent=error.message || 'Could not save user rights.';}
  finally{button.disabled=false;}
 };
}
function editUser(id) {
 const user=users.find(u=>u.id===id);if(!user || !manager())return;
 ensureDialog();editing=id;const dialog=document.getElementById('rxUserAccess');
 dialog.querySelector('#rxAccessUser').textContent=user.username;
 dialog.querySelector('#rxAccessUsername').value=user.username;
 dialog.querySelector('#rxAccessName').value=user.display_name || '';
 dialog.querySelector('#rxAccessActive').checked=user.is_active===true;
 dialog.querySelectorAll('[data-right]').forEach(box=>{box.checked=user.permissions?.[box.dataset.right]===true;});
 dialog.querySelector('#rxAccessError').textContent='';dialog.showModal();
}
async function loadUsers() {
 const tbody=document.getElementById('userListBody');if(!tbody)return;
 await refresh();if(!manager()){tbody.replaceChildren();return;}
 try {
  users=await rpc('app_get_user_access');tbody.replaceChildren();
  users.forEach(user=>{
   const row=document.createElement('tr');
   [user.username, user.role+(user.is_active?' · Active':' · Inactive')].forEach(text=>{const td=document.createElement('td');td.textContent=text;row.append(td);});
   const cell=document.createElement('td');row.append(cell);
   const self=user.id===getSession().userId;
   if(!self && user.role==='user') {
    const edit=document.createElement('button');edit.type='button';edit.className='rx-user-action';edit.textContent='Modify / Rights';edit.onclick=()=>editUser(user.id);cell.append(edit);
   }
   if(!self && user.role!=='super_admin' && (serverRole==='super_admin' || user.role==='user')) {
    const reset=document.createElement('button');reset.type='button';reset.className='rx-user-action rx-reset';reset.textContent='Reset Password';reset.onclick=()=>resetUserPassword(user.id);cell.append(reset);
    const del=document.createElement('button');del.type='button';del.className='rx-user-action rx-delete';del.textContent='Delete';del.onclick=()=>deleteUser(user.id);cell.append(del);
   }
   if(!cell.childNodes.length)cell.textContent='Full administrator access';tbody.append(row);
  });
 } catch(error) {tbody.replaceChildren();const row=tbody.insertRow(),cell=row.insertCell();cell.colSpan=3;cell.textContent='Unable to load user rights: '+error.message;}
}
window.RecountixPermissions={can,refresh,require:requireRight,apply,loadUsers,fields};
window.rxCan=can;window.rxRequire=requireRight;
window.rxPermissionsReady=getSession().isLoggedIn && getSession().sessionToken ? refresh() : Promise.resolve();
window.addEventListener('load',()=>{
 const style=document.createElement('style');style.textContent=`.rx-permission-hidden{display:none!important}#rxAccessBlocked{position:fixed;inset:0;z-index:100000;background:#f1f5f9;display:grid;place-items:center;padding:24px;color:#18344e}#rxAccessBlocked>div{max-width:440px;background:white;padding:28px;border-radius:18px}#rxUserAccess{border:0;border-radius:18px;max-width:760px;width:calc(100% - 32px);max-height:90vh;padding:24px;color:#18344e;background:#fff}#rxUserAccess::backdrop{background:#172b4d80}.rx-account-fields,.rx-rights-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.rx-account-fields input{display:block;width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccd7e2;border-radius:8px}.rx-active{display:flex;gap:10px;margin:16px 0}.rx-right{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid #d9e2ec;border-radius:12px}.rx-right input,.rx-active input{width:18px;height:18px;flex-shrink:0}.rx-right small{display:block;margin-top:5px;color:#536b80;line-height:1.4}.rx-presets,.rx-dialog-actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.rx-dialog-actions{justify-content:flex-end}.rx-presets button,.rx-dialog-actions button,.rx-user-action{padding:10px 14px;border:1px solid #c7d6e5;border-radius:8px;background:#eff5fb;color:#18344e;cursor:pointer}#rxAccessSave{background:#1a3d63;color:white}.rx-reset{color:#0B5D4F;margin-left:6px}.rx-delete{color:#b91c1c;margin-left:6px}#rxAccessError{color:#b91c1c}@media(max-width:600px){.rx-account-fields,.rx-rights-grid{grid-template-columns:1fr}#rxUserAccess{padding:18px}}`;
 document.head.append(style);apply();
 // Existing tables are rendered dynamically, so update controls after row changes.
 let queued=false;
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;apply();});}).observe(document.body,{childList:true,subtree:true});
 setInterval(()=>{if(!document.hidden && getSession().isLoggedIn)refresh();},15000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden && getSession().isLoggedIn)refresh();});
});
})();
