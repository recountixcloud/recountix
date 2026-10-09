const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = {};
for (const id of ['portalForm','shopCode','mobile','pin','checkBtn','errorBox','summary','emptyState','customerName','businessName','statusChip','billAmount','paidAmount','pendingAmount','lastPayment','paymentsList']) {
  elements[id] = {value:'',style:{},dataset:{},innerHTML:'Check Status',classList:{add(){},remove(){}},addEventListener(type,fn){this[type]=fn;}};
}
const document = {getElementById:id=>elements[id],querySelectorAll:()=>[],documentElement:{}};
let response, call;
const context = {document,console,localStorage:{getItem(){throw Error('Storage blocked');},setItem(){throw Error('Storage blocked');}},getSupabase:()=>({rpc:async(name,args)=>{call={name,args};return response;}})};
vm.runInNewContext(fs.readFileSync('frontend/js/customer-portal.js','utf8'),context);
(async()=>{
  await elements.portalForm.submit({preventDefault(){}});
  assert.match(elements.errorBox.textContent,/Enter business code/);
  elements.shopCode.value='DEMO';elements.mobile.value='9999999999';elements.pin.value='1234';
  response={data:{customer_name:'Test',bill_amount:1000,paid_amount:200,pending_amount:800,recent_payments:[{amount:200,mode:'<script>',receipt_no:'<img>'}]},error:null};
  await elements.portalForm.submit({preventDefault(){}});
  assert.equal(call.name,'app_customer_self_view');
  assert.equal(call.args.p_pin,'1234');
  assert.equal(elements.customerName.textContent,'Test');
  assert(!elements.paymentsList.innerHTML.includes('<script>'));
  assert.equal(elements.checkBtn.disabled,false);
  response={data:{error:'temporarily_locked'},error:null};
  await elements.portalForm.submit({preventDefault(){}});
  assert.match(elements.errorBox.textContent,/15 minutes/);
  response={data:{error:'maintenance_mode'},error:null};
  await elements.portalForm.submit({preventDefault(){}});
  assert.match(elements.errorBox.textContent,/maintenance/);
  console.log('Portal checks passed: blocked storage, required fields, lookup, safe rendering, lockout, maintenance.');
})().catch(e=>{console.error(e);process.exit(1);});
