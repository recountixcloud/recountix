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
    if(name==='app_get_my_permissions')data={role,permissions:window.__rights};
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
 for(const viewport of [{width:1365,height:900},{width:390,height:844}]){
  const {page,context}=await setup('admin',all,viewport);
  await page.goto(root+'/settings.html');await expand(page);await page.getByRole('button',{name:'Modify / Rights'}).waitFor();
  await page.getByRole('button',{name:'Modify / Rights'}).click();
  const modal=page.locator('#rxUserAccess');await modal.waitFor();
  await modal.getByRole('button',{name:'Allow all business rights'}).click();
  assert.equal(await modal.locator('[data-right]:checked').count(),7);passed++;
  await modal.locator('[data-right="delete"]').uncheck();
  await modal.getByRole('button',{name:'Save rights',exact:true}).click();await modal.waitFor({state:'hidden'});
  const updates=await page.evaluate(()=>window.__updates);assert.equal(updates[0].p_payload.permissions.delete,false);assert.equal(updates[0].p_payload.permissions.modify,true);passed++;
  await page.getByRole('button',{name:'Modify / Rights'}).click();
  await modal.getByRole('button',{name:'Allow all business rights'}).click();await modal.locator('[data-right="view"]').uncheck();
  assert.equal(await modal.locator('[data-right]:checked').count(),0);passed++;
  const box=await modal.boundingBox();assert(box.x>=0 && box.x+box.width<=viewport.width);passed++;
  if(process.env.RECOUNTIX_SCREENSHOTS)await page.screenshot({path:require('node:path').join(process.env.RECOUNTIX_SCREENSHOTS,'rights-'+viewport.width+'.png')});
  await context.close();
 }
 const view={...all,add:false,modify:false,delete:false,settings:false,backup:false,restore:false};
 {
  const {page,context}=await setup('user',view,{width:390,height:844});await page.goto(root+'/customers.html');await expand(page);await page.locator('#customerBody').getByText('Test Customer').waitFor();
  assert.equal(await page.locator('[onclick^="editCustomer"]').isVisible(),false);assert.equal(await page.locator('[onclick^="deleteCustomer"]').count(),0);passed++;
  await page.goto(root+'/settings.html');await page.locator('#rxAccessBlocked').waitFor();assert.equal(await page.locator('#userManagementSection').isVisible(),false);passed++;
  await context.close();
 }
 {
  const {page,context}=await setup('user',{...view,modify:true,delete:true,settings:true},{width:1365,height:900});await page.goto(root+'/customers.html');await expand(page);await page.locator('[onclick^="editCustomer"]').waitFor();await page.locator('[onclick^="editCustomer"]').click();assert.equal(await page.locator('#customerModal').isVisible(),true);passed++;
  await page.goto(root+'/recovery.html');await expand(page);await page.locator('[onclick^="editRecovery"]').waitFor();await page.locator('[onclick^="editRecovery"]').click();await page.locator('#rxEditRecovery').waitFor();passed++;
  await page.goto(root+'/settings.html');await page.evaluate(()=>window.rxPermissionsReady);assert.equal(await page.locator('#rxAccessBlocked').count(),0);assert.equal(await page.locator('#userManagementSection').isVisible(),false);passed++;
  await context.close();
 }
 await browser.close();console.log(passed+' UI checks passed (desktop and mobile).');
})().catch(e=>{console.error(e);process.exit(1)});
