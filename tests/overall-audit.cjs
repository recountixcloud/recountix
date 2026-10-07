const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const fields={},rows=[{textContent:'Alice Cash 600',hidden:false},{textContent:'Bob UPI 100',hidden:false}];
const document={getElementById:id=>fields[id]||null,querySelector:()=>null,querySelectorAll:s=>s==='#recoveryBody tr'?rows:[],addEventListener(){},readyState:'loading',documentElement:{},body:{}};
const ctx={document,console:{log(){},warn(){},error(){}},setTimeout(){},setInterval(){},clearTimeout(){},localStorage:{getItem(){return null},setItem(){}},sessionStorage:{getItem(){return null},setItem(){}},location:{pathname:'/frontend/recovery.html'},navigator:{},MutationObserver:class{observe(){}},addEventListener(){},getSession:()=>({sessionToken:'test-token',shopId:'test-shop'}),rxRequire:()=>true,escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),crypto:require('node:crypto').webcrypto};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('frontend/js/db.js','utf8'),ctx);vm.runInContext(fs.readFileSync('frontend/js/app.js','utf8'),ctx);
(async()=>{
 fields.searchRecovery={value:'alice'};ctx.searchRecovery();assert.equal(rows[0].hidden,false);assert.equal(rows[1].hidden,true);
 fields.searchRecovery.value='';ctx.searchRecovery();assert.equal(rows[1].hidden,false);
 fields.billAmount={value:'1200'};fields.downPayment={value:'200'};fields.outstanding={};
 vm.runInContext('customers=[{bill:1000,down:100,outstanding:300}];editIndex=0;',ctx);
 ctx.calculateOutstanding();assert.equal(fields.outstanding.value,400);
 let called;
 ctx.getSupabase=()=>({rpc:async(name,args)=>{called={name,args};return {data:name==='app_get_settings'?{extra:{upi_id:'audit@upi',website:'https://example.test',executives:[]}}:{},error:null}}});
 ctx.rxReadPreferences=()=>({autoBackup:"off"});
 const settings=await ctx.sbGetSettings();assert.equal(settings.upiId,'audit@upi');assert.equal(settings.website,'https://example.test');
 await ctx.sbSaveSettings('test-shop',{upiId:'audit@upi',website:'https://example.test'});assert.equal(called.args.p_payload.upiId,'audit@upi');
 ctx.isSuperAdmin=()=>false;ctx.currentShopId=()=>"test-shop";ctx.alert=()=>{};fields.companyName={value:"Test Company"};await ctx.saveCompanyBranding();assert.equal(called.name,"app_save_settings");
 fields.ptpTableBody={innerHTML:''};fields.ptpStatusFilter={value:'all'};
 vm.runInContext('customers=[{id:"c",name:"<img src=x onerror=alert(1)>"}]',ctx);
 ctx.sbGetPtp=async()=>[{id:'p',customer_id:'c',promised_amount:5,promised_date:'2026-10-02',status:'open',notes:'<script>attack</script>'}];
 await ctx.loadPtpTable();assert(!fields.ptpTableBody.innerHTML.includes('<script>'));assert(!fields.ptpTableBody.innerHTML.includes('<img'));
 ctx.getSupabase=()=>({rpc:async()=>({data:{error:'verified_recovery_required'},error:null})});
 await assert.rejects(ctx.sbResetPasswordByRecovery('name','email','password'),/verified_recovery_required/);
 console.log('8 frontend regression checks passed: search, edit balance, settings round trip, safe PTP rendering, reset guard.');
})().catch(e=>{console.error(e);process.exit(1)});

