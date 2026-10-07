/* Recountix offline backup history page */
(function(){
"use strict";
const $=id=>document.getElementById(id);
function msg(text,type){const el=$("backupStatus");el.textContent=text;el.className="backup-status "+(type||"");}
function fmt(d){try{return new Date(d).toLocaleString("en-IN")}catch(e){return d||"-"}}
function size(n){n=Number(n)||0;if(n<1024)return n+" B";if(n<1048576)return(n/1024).toFixed(1)+" KB";return(n/1048576).toFixed(2)+" MB";}
function renderAutoStatus(){
 const id=selectedShop(),el=$("autoBackupState");if(!el)return;
 if(!id){el.textContent="Select one business to view its automatic backup status.";el.className="auto-backup-state idle";return;}
 const st=RecountixOfflineBackup.getStatus(id),when=st.lastSuccessAt?" Last success: "+fmt(st.lastSuccessAt)+".":"";
 el.textContent=(st.message||"Automatic backup is ready.")+when;el.className="auto-backup-state "+(st.state||"idle");
}
async function shops(){
 const s=getSession(),wrap=$("shopSelectWrap"),sel=$("backupShop");
 if(s.role==="super_admin")throw new Error("Super Admin cannot export or restore business backups. Use a business Administrator login.");
 wrap.hidden=true;sel.innerHTML='<option value="'+escapeHtml(s.shopId)+'">'+escapeHtml(s.shopName||"My Business")+'</option>';sel.value=s.shopId;
}
function selectedShop(){return getSession().shopId;}
function visibleShop(){return getSession().shopId;}
async function refresh(){
 const rows=await RecountixOfflineBackup.list(visibleShop()),body=$("backupList");
 body.innerHTML=rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.shopName||r.shopCode)+'</td><td>'+escapeHtml(r.shopCode)+'</td><td>'+escapeHtml(fmt(r.createdAt))+'</td><td>'+escapeHtml(String(r.recordCount==null?"—":r.recordCount))+'</td><td>'+escapeHtml(size(r.byteSize))+'</td><td><div class="backup-actions"><button type="button" class="add-btn download-local" data-id="'+escapeHtml(r.id)+'">Download</button><button type="button" class="delete-btn delete-local" data-id="'+escapeHtml(r.id)+'">Delete</button></div></td></tr>').join(""):'<tr><td colspan="6">No offline backups for this business yet.</td></tr>';
 body.querySelectorAll(".download-local").forEach(b=>b.addEventListener("click",()=>download(b.dataset.id)));
 body.querySelectorAll(".delete-local").forEach(b=>b.addEventListener("click",()=>removeBackup(b.dataset.id)));
 renderAutoStatus();
}
async function sync(){
 const id=selectedShop();if(!id)return msg("Select one business before creating a backup.","error");
 msg("Creating encrypted offline backup…");await RecountixOfflineBackup.capture(id);msg("A new backup was added to history.","success");await refresh();
}
async function download(id){
 const pass=$("backupPass").value;if(pass.length<8)return msg("Enter a backup password of at least 8 characters.","error");
 msg("Encrypting download…");const pack=await RecountixOfflineBackup.makePortable(id,pass),blob=new Blob([JSON.stringify(pack)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="recountix-"+(pack.shop_code||"business")+"-"+new Date(pack.created_at||Date.now()).toISOString().replace(/[:.]/g,"-")+".rxbackup";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);msg("Encrypted backup downloaded.","success");
}
async function removeBackup(id){
 if(!confirm("Delete this offline backup from this device? This cannot be undone."))return;
 await RecountixOfflineBackup.remove(id);msg("Old device backup deleted.","success");await refresh();
}
async function restore(){
 if(!rxRequire("restore"))return;
 const file=$("restoreFile").files[0],pass=$("restorePass").value;if(!file)return msg("Choose a .rxbackup file.","error");if(pass.length<8)return msg("Enter the backup file password.","error");if(!navigator.onLine)return msg("Internet is required to restore into Supabase.","error");
 msg("Validating encrypted backup…");const pack=JSON.parse(await file.text()),data=await RecountixOfflineBackup.openPortable(pack,pass),s=getSession();
 if(String(data.shop_id)!==String(s.shopId))throw new Error("This backup belongs to another business.");
 if(!confirm("Restore missing records for "+(data.shop_name||data.shop_code)+"? Existing records will not be overwritten or deleted."))return msg("Restore cancelled.");
 msg("Restoring missing records…");const result=await sbRestoreBusinessBackup(data);msg("Restore completed for this business.","success");if(rxCan("backup")){await RecountixOfflineBackup.capture(data.shop_id);await refresh();}return result;
}
async function boot(){try{await window.rxPermissionsReady;const s=getSession();if(!s.isLoggedIn)return location.replace("login.html");await shops();if(rxCan("backup"))await refresh();window.addEventListener("recountix:backup-status",renderAutoStatus);$("syncBackup").onclick=()=>sync().catch(e=>msg(e.message||String(e),"error"));$("restoreBackup").onclick=()=>restore().catch(e=>msg(e.message==="OperationError"?"Wrong backup password or damaged file.":(e.message||String(e)),"error"));}catch(e){msg(e.message||String(e),"error");}}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",boot,{once:true}):boot();
})();
