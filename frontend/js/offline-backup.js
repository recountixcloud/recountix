/* Recountix encrypted offline backup engine */
(function(){
"use strict";
const DB_NAME="recountix-offline-v1", DB_VERSION=2, STORE_BACKUPS="backups", STORE_KEYS="keys";
function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE_BACKUPS))d.createObjectStore(STORE_BACKUPS,{keyPath:"id"});if(!d.objectStoreNames.contains(STORE_KEYS))d.createObjectStore(STORE_KEYS);};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function idbGet(store,key){const d=await openDb();return new Promise((res,rej)=>{const q=d.transaction(store,"readonly").objectStore(store).get(key);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}
async function idbPut(store,value,key){const d=await openDb();return new Promise((res,rej)=>{const tx=d.transaction(store,"readwrite"),os=tx.objectStore(store);key===undefined?os.put(value):os.put(value,key);tx.oncomplete=()=>res(value);tx.onerror=()=>rej(tx.error);});}
function currentShopId(){try{const s=typeof getSession==="function"?getSession():null;return s&&s.isLoggedIn&&s.shopId?String(s.shopId):"";}catch(e){return "";}}
function assertShopAccess(shopId){if(!window.rxCan || !rxCan("backup"))throw new Error("Backup permission is required.");const current=currentShopId();if(!current||String(shopId)!==current)throw new Error("This backup belongs to another business or signed-out session.");return current;}
async function deviceKey(shopId){const scoped=assertShopAccess(shopId),keyId="device-aes:"+scoped;let k=await idbGet(STORE_KEYS,keyId);if(k)return k;k=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);await idbPut(STORE_KEYS,k,keyId);return k;}
function b64(bytes){let s="",u=new Uint8Array(bytes);for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);}
function unb64(s){const x=atob(s),u=new Uint8Array(x.length);for(let i=0;i<x.length;i++)u[i]=x.charCodeAt(i);return u;}
async function encryptObject(obj,key){const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode(JSON.stringify(obj)),cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,plain);return{iv:b64(iv),cipher:b64(cipher)};}
async function decryptObject(payload,key){const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(payload.iv)},key,unb64(payload.cipher));return JSON.parse(new TextDecoder().decode(plain));}
async function portableKey(pass,salt){const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:250000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);}
function statusKey(shopId){return "rx_backup_status_"+shopId;}
function setStatus(shopId,state,message,extra){
  if(!shopId)return;const previous=getStatus(shopId),value=Object.assign({},previous,extra||{},{shopId,state,message,updatedAt:new Date().toISOString()});
  localStorage.setItem(statusKey(shopId),JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("recountix:backup-status",{detail:value}));
}
function getStatus(shopId){try{return JSON.parse(localStorage.getItem(statusKey(shopId))||"null")||{shopId,state:"idle",message:"No automatic backup status yet."};}catch(e){return{shopId,state:"idle",message:"No automatic backup status yet."};}}
function setPending(shopId,pending){if(shopId)localStorage.setItem("rx_backup_pending_"+shopId,pending?"true":"false");}
function isPending(shopId){return localStorage.getItem("rx_backup_pending_"+shopId)==="true";}
async function capture(shopId){
  const requested=shopId||null;
  if(!navigator.onLine){setStatus(requested,"waiting","Offline — automatic backup will retry when internet returns.");throw new Error("Internet is required to create a fresh Supabase backup.");}
  if(typeof sbExportBusinessBackup!=="function"){setStatus(requested,"failed","Backup API is unavailable.");throw new Error("Backup API is unavailable.");}
  setStatus(requested,"running","Creating encrypted backup…",{lastAttemptAt:new Date().toISOString()});
  try{
    const data=await sbExportBusinessBackup(requested);
    if(!data||data.format!=="recountix-offline-backup"||!data.shop_id)throw new Error("Invalid backup response.");
    const key=await deviceKey(data.shop_id),encrypted=await encryptObject(data,key),createdAt=data.exported_at||new Date().toISOString(),rawBytes=new TextEncoder().encode(JSON.stringify(data)).byteLength,recordCount=Object.values(data.tables||{}).reduce((n,rows)=>n+(Array.isArray(rows)?rows.length:0),0),suffix=crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2),row={id:"shop:"+data.shop_id+":"+Date.now()+":"+suffix,shopId:data.shop_id,shopCode:data.shop_code||"",shopName:data.shop_name||"",createdAt,recordCount,byteSize:rawBytes,encrypted};
    await idbPut(STORE_BACKUPS,row);localStorage.setItem("rx_last_backup_"+data.shop_id,row.createdAt);setPending(data.shop_id,false);setStatus(data.shop_id,"success","Automatic backup is up to date.",{lastSuccessAt:row.createdAt,recordCount,byteSize:rawBytes});return row;
  }catch(e){setPending(requested,true);setStatus(requested,"failed",e.message||"Automatic backup failed.",{lastFailureAt:new Date().toISOString()});throw e;}
}
async function list(shopId){const scoped=assertShopAccess(shopId);const d=await openDb();return new Promise((res,rej)=>{const q=d.transaction(STORE_BACKUPS,"readonly").objectStore(STORE_BACKUPS).getAll();q.onsuccess=()=>{const rows=(q.result||[]).filter(r=>String(r.shopId)===scoped);res(rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))));};q.onerror=()=>rej(q.error);});}
async function read(backupId){let row=await idbGet(STORE_BACKUPS,backupId);if(!row)row=await idbGet(STORE_BACKUPS,"shop:"+backupId);if(!row)return null;assertShopAccess(row.shopId);return decryptObject(row.encrypted,await deviceKey(row.shopId));}
async function remove(backupId){let row=await idbGet(STORE_BACKUPS,backupId);if(!row)row=await idbGet(STORE_BACKUPS,"shop:"+backupId);if(row)assertShopAccess(row.shopId);const d=await openDb();return new Promise((res,rej)=>{const tx=d.transaction(STORE_BACKUPS,"readwrite");tx.objectStore(STORE_BACKUPS).delete(backupId);tx.oncomplete=()=>res(true);tx.onerror=()=>rej(tx.error);});}
async function makePortable(backupId,passphrase){
  if(String(passphrase||"").length<8)throw new Error("Backup password must be at least 8 characters.");
  const data=await read(backupId);if(!data)throw new Error("Offline backup was not found.");
  const salt=crypto.getRandomValues(new Uint8Array(16)),key=await portableKey(passphrase,salt),enc=await encryptObject(data,key);
  return{format:"recountix-encrypted-file",version:1,kdf:"PBKDF2-SHA256",iterations:250000,salt:b64(salt),iv:enc.iv,cipher:enc.cipher,shop_code:data.shop_code||"",created_at:data.exported_at};
}
async function openPortable(fileObject,passphrase){
  if(!fileObject||fileObject.format!=="recountix-encrypted-file"||fileObject.version!==1)throw new Error("Unsupported backup file.");
  const key=await portableKey(passphrase,unb64(fileObject.salt));
  const data=await decryptObject({iv:fileObject.iv,cipher:fileObject.cipher},key);
  if(!data||data.format!=="recountix-offline-backup"||!data.shop_id)throw new Error("Invalid backup contents.");
  return data;
}
async function auto(force){
  try{
    await window.rxPreferencesReady;await window.rxPermissionsReady;if(!window.rxCan || !rxCan("backup"))return;
    if(typeof getSession!=="function")return;const s=getSession();if(!s.isLoggedIn||!s.sessionToken||!s.shopId)return;
    if(window.rxPreferencesLoaded===false)return;
    const schedule=window.rxPreferences?.autoBackup||"daily";
    if(schedule==="off"){setStatus(s.shopId,"idle","Automatic backup is disabled in Settings.");return;}
    const interval={daily:86400000,weekly:604800000,monthly:2592000000}[schedule]||86400000;
    const last=Date.parse(localStorage.getItem("rx_last_backup_"+s.shopId)||0),due=!Number.isFinite(last)||Date.now()-last>=interval;
    if(!navigator.onLine){if(due||isPending(s.shopId)){setPending(s.shopId,true);setStatus(s.shopId,"waiting","Offline — backup will retry automatically.");}return;}
    if(!due)return;
    await capture(s.shopId);
  }catch(e){console.warn("Offline backup skipped:",e.message||e);}
}
function markChanged(){
  try{const s=getSession();if(!s.shopId)return;setPending(s.shopId,true);setStatus(s.shopId,"pending","Data changed — encrypted backup is queued.");setTimeout(()=>auto(false),800);}catch(e){}
}
function wrapMutations(){
  ["sbSaveCustomer","sbDeleteCustomer","sbSaveRecovery","sbModifyRecovery","sbDeleteRecovery","sbSaveSettings","sbMarkReminder"].forEach(name=>{const fn=window[name];if(typeof fn!=="function"||fn.__rxBackupWrapped)return;const wrapped=async function(){const out=await fn.apply(this,arguments);markChanged();return out;};wrapped.__rxBackupWrapped=true;window[name]=wrapped;});
}
function startScheduler(){
  wrapMutations();setTimeout(()=>auto(false),1800);setInterval(()=>auto(false),60000);
  window.addEventListener("online",()=>auto(true));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")auto(false);});
}
window.RecountixOfflineBackup={capture,list,read,remove,makePortable,openPortable,auto,getStatus};
window.addEventListener("load",startScheduler,{once:true});
})();
