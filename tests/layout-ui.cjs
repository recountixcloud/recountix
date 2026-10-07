const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.RECOUNTIX_CHROMIUM_PATH,args:process.env.RECOUNTIX_CHROMIUM_ARGS?JSON.parse(process.env.RECOUNTIX_CHROMIUM_ARGS):[]});
 const root=process.env.RECOUNTIX_TEST_URL || 'http://127.0.0.1:8765';
 const all={view:true,add:true,modify:true,delete:true,settings:true,backup:true,restore:true};
 let passed=0;
 async function setup(role,permissions,viewport){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addInitScript(({role,permissions})=>{
   for(const [key,value] of Object.entries({bk_isLoggedIn:'true',bk_userId:role==='admin'?'admin-a':'user-a',bk_username:role,bk_role:role,bk_shopId:'shop-a',bk_shopName:'Demo Business',bk_session_token:'synthetic-ui-token'}))sessionStorage.setItem(key,value);
   window.__rights=permissions;window.__role=role;window.__updates=[];
   window.__rpc=async(name,args)=>{
    const user={id:role==='admin'?'admin-a':'user-a',username:role,role,shop_id:'shop-a',display_name:role};
    let data=[];
    if(name==='app_superadmin')data=[];
    else if(name==='app_get_my_permissions')data={role,permissions:window.__rights};
    else if(name==='app_validate_session')data={valid:true,user};
    else if(name==='app_maintenance_status')data={maintenance_mode:false};
    else if(name==='app_get_settings')data={company_name:'Demo Business',extra:{executives:[]}};
    else if(name==='app_get_shops')data=[{id:'shop-a',name:'Demo Business',is_active:true}];
    else if(name==='app_get_user_access')data=[{...user,id:'admin-a',role:'admin',username:'owner',is_active:true,permissions:window.__rights},{id:'user-a',role:'user',username:'staff',display_name:'Staff',is_active:true,permissions:{view:true,add:false,modify:false,delete:false,settings:false,backup:false,restore:false}}];
    else if(name==='app_update_user_access'){window.__updates.push(args);data={ok:true};}
    else if(name==='app_get_customers')data=[{id:'customer-a',name:'Test Customer',mobile:'9999999999',shop_id:'shop-a',bill:1000,down_payment:0,outstanding:900}];
    else if(name==='app_get_recoveries')data=[{id:'recovery-a',customer_id:'customer-a',amount:100,recovery_date:'2026-09-26',payment_mode:'Cash'}];
    else if(name==='app_aging')data={};
    return {data,error:null};
   };
  },{role,permissions});
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url.startsWith(root))return route.continue();
   if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:function(){return {rpc:window.__rpc}}};'});
   return route.abort();
  });
  const page=await context.newPage();page.on('dialog',d=>d.accept());
  return {page,context};
 }
 async function expand(page) {
  await page.waitForFunction(()=>window.rcApplyCompactViews);
  await page.evaluate(()=>window.rcApplyCompactViews());
  for(const button of await page.locator('.rc-view-details').all()) {
   if(await button.isVisible() && await button.getAttribute('aria-expanded')==='false')await button.click();
  }
 }

 const pages=['dashboard','customers','recovery','ptp','escalations','activity','field-tracking','reports','settings','backup','super-dashboard','companies','subscription','ad-manager'];
 for(const viewport of [{width:390,height:844},{width:1365,height:900}]){
  for(const name of pages){
   const role=['super-dashboard','companies','subscription','ad-manager'].includes(name)?'super_admin':'admin';
   const {page,context}=await setup(role,all,viewport);
   await page.goto(root+'/'+name+'.html');await page.evaluate(()=>window.rxPermissionsReady);
   const sidebar=page.locator('.sidebar'),toggle=page.locator('#menuToggle');
   await toggle.waitFor();
   assert((await sidebar.boundingBox()).x+(await sidebar.boundingBox()).width<=1,name+' initially hidden');passed++;
   await toggle.click();await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().x>=-1);
   assert.equal(await toggle.getAttribute('aria-expanded'),'true');passed++;
   await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);passed++;
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' no page overflow');passed++;
   await context.close();
  }
 }
 for(const viewport of [{width:390,height:844},{width:1365,height:900},{width:980,height:1400}]){
  const {page,context}=await setup('super_admin',all,viewport);
  await page.goto(root+'/companies.html');await page.locator('#addShopButton').click();
  const modal=page.locator('#shopModal'),content=modal.locator('.modal-content');await modal.waitFor();
  const bounds=await content.boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height);passed++;
  assert(bounds.width>=Math.min(600,viewport.width-60),'Useful form width');passed++;
  await page.locator('#shopName').fill('Demo Business');await page.locator('#shopCode').fill('DEMO');await page.locator('#shopEmail').fill('demo@example.test');
  const last=page.locator('#shopAdminPassword');if(await last.count())await last.fill('ExamplePassword42');
  assert.equal(await page.locator('#shopName').inputValue(),'Demo Business');passed++;
  assert.equal(await page.locator('.wrapper').evaluate(el=>el.inert),true);passed++;
  if(viewport.width===390){
   assert.equal(await page.locator('#shopName').evaluate(el=>getComputedStyle(el).fontSize),'16px');passed++;
   await page.setViewportSize({width:390,height:390});
   const save=modal.locator('button').filter({hasText:'Save'});await save.scrollIntoViewIfNeeded();
   const b=await save.boundingBox();assert(b.y>=0&&b.y+b.height<=390,'Save reachable with keyboard');passed++;
   await page.setViewportSize(viewport);
  }
  await content.evaluate(el=>el.scrollTop=0);
  if(process.env.RECOUNTIX_SCREENSHOTS)await page.screenshot({path:require('node:path').join(process.env.RECOUNTIX_SCREENSHOTS,'business-form-'+viewport.width+'.png')});
  await page.keyboard.press('Escape');assert.equal(await modal.isVisible(),false);assert.equal(await page.locator('.wrapper').evaluate(el=>el.inert),false);passed++;
  await context.close();
 }
 {
  const {page,context}=await setup('admin',all,{width:390,height:844});await page.goto(root+'/customers.html');await page.evaluate(()=>window.rxPermissionsReady);
  assert.equal(await page.locator('#customerModal').isVisible(),false);passed++;
  await page.evaluate(()=>openModal());await page.locator('#customerModal').waitFor();
  assert.equal(await page.locator('#customerModal').evaluate(el=>el.parentElement===document.body),true);passed++;
  const b=await page.locator('#customerModal .modal-content').boundingBox();assert(b.y>=0&&b.y+b.height<=844);passed++;
  await page.keyboard.press('Escape');await context.close();
 }
 await browser.close();console.log(passed+' layout checks passed across 14 pages, mobile, desktop, and a reduced keyboard viewport.');
})().catch(e=>{console.error(e);process.exit(1)});
