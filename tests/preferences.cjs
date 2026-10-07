const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let now=Date.parse('2026-10-02T12:00:00Z');class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function memory(){const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
const fields={},listeners={},intervals=[];let cleared=false,saved,exportCalls=0;
const store=memory();const session={isLoggedIn:true,userId:'synthetic',shopId:'a',sessionToken:'synthetic-token'};
const ctx={Date:ClockDate,console,Promise,CustomEvent:class{},document:{getElementById:id=>fields[id]||null,querySelectorAll:()=>[],addEventListener:(n,fn)=>listeners[n]=fn},getSession:()=>session,storage:()=>store,currentShopId:()=>session.shopId,sbGetSettings:async()=>({preferences:{autoLogout:'5',sessionTimeout:'30'}}),sbSaveSettings:async(s,row)=>{saved=row;},getSupabase:()=>({rpc:async()=>({})}),clearSession:()=>{cleared=true;},location:{replace:url=>ctx.redirect=url},setInterval:fn=>intervals.push(fn),setTimeout(){},alert(){},navigator:{onLine:true},localStorage:memory(),rxCan:()=>true,sbExportBusinessBackup:async()=>{exportCalls++;throw new Error('synthetic export probe');}};
ctx.window=ctx;ctx.addEventListener=(n,fn)=>listeners['window:'+n]=fn;ctx.dispatchEvent=()=>{};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('frontend/js/preferences.js','utf8'),ctx);
(async()=>{
 await listeners['window:load']();assert.equal(ctx.rxPreferences.autoLogout,'5');
 ctx.rxApplyPreferences({dateFormat:'yyyy-mm-dd'});assert.equal(ctx.rxFormatDate('2026-10-02'),'2026-10-02');ctx.rxApplyPreferences({dateFormat:'mm-dd-yyyy'});assert.equal(ctx.rxFormatDate('2026-10-02'),'10-02-2026');ctx.rxApplyPreferences({dateFormat:'dd-mm-yyyy'});assert.equal(ctx.rxFormatDate('2026-10-02'),'02-10-2026');assert.equal(ctx.rxFormatDate('invalid'),'-');
 fields.dateFormat={value:'yyyy-mm-dd'};fields.autoBackup={value:'off'};await ctx.savePreferences();assert.equal(saved.preferences.autoBackup,'off');assert.equal(ctx.rxPreferences.dateFormat,'yyyy-mm-dd');
 ctx.rxApplyPreferences({autoLogout:'5',sessionTimeout:'30'});now+=4*60000;listeners.pointerdown();assert.equal(cleared,false);now+=5*60000+1;intervals[0]();assert.equal(cleared,true);assert.equal(ctx.redirect,'login.html');
 cleared=false;ctx.redirect=null;session.sessionToken='new-token';vm.runInContext(fs.readFileSync('frontend/js/preferences.js','utf8'),ctx);await listeners['window:load']();for(let i=0;i<8;i++){now+=4*60000;listeners.pointerdown();}assert.equal(cleared,true,'Activity must not extend total session duration');
 session.sessionToken='backup-token';vm.runInContext(fs.readFileSync('frontend/js/offline-backup.js','utf8'),ctx);ctx.rxPreferencesLoaded=true;
 const last=now-2*86400000;ctx.localStorage.setItem('rx_last_backup_a',new ClockDate(last).toISOString());
 ctx.rxPreferences={autoBackup:'off'};await ctx.RecountixOfflineBackup.auto(true);assert.equal(exportCalls,0);
 ctx.rxPreferences={autoBackup:'weekly'};await ctx.RecountixOfflineBackup.auto(true);assert.equal(exportCalls,0);
 ctx.rxPreferences={autoBackup:'daily'};await ctx.RecountixOfflineBackup.auto(false);assert.equal(exportCalls,1);
 ctx.rxPreferences={autoBackup:'monthly'};await ctx.RecountixOfflineBackup.auto(true);assert.equal(exportCalls,1);
 ctx.localStorage.setItem('rx_last_backup_a',new ClockDate(now-31*86400000).toISOString());await ctx.RecountixOfflineBackup.auto(false);assert.equal(exportCalls,2);
 console.log('Preferences checks passed: persistence, 3 date formats, invalid date, idle expiry, absolute expiry, disabled/daily/weekly/monthly backup schedules.');
})().catch(e=>{console.error(e);process.exit(1);});
