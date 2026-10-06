/* ==========================================================
   RECOUNTIX - Supabase Data Layer
   CRUD for customers, recoveries, users, shops, settings
========================================================== */

/* LOGIN is handled in auth.js (sbLogin with shop/license checks) */

/* ---------- SHOPS ---------- */
async function sbGetShops() {
    const token=getSession().sessionToken;if(!token)return[];
    const {data,error}=await getSupabase().rpc("app_get_shops",{p_token:token});
    if(error)throw error;return data||[];
}

/* ---------- CUSTOMERS ---------- */
function mapCustomerFromDb(row) {
    if (!row) return null;
    return {
        id: row.id,
        shop_id: row.shop_id,
        name: row.name || "",
        productName: row.product_name || "",
        father: row.father || "",
        mobile: row.mobile || "",
        altMobile: row.alt_mobile || "",
        village: row.village || "",
        taluka: row.taluka || "",
        district: row.district || "",
        address: row.address || "",
        aadhaar: row.aadhaar || "",
        pan: row.pan || "",
        bill: Number(row.bill || 0),
        down: Number(row.down_payment || 0),
        outstanding: Number(row.outstanding || 0),
        executive: row.executive || "",
        followup: row.followup || "",
        status: row.status || "Active",
        priority: row.priority || "Low",
        remarks: row.remarks || "",
        autoReminder: row.auto_reminder !== false,
        reminderInterval: Number(row.reminder_interval_days || 3),
        lastReminderAt: row.last_reminder_at || "",
        nextReminderDate: row.next_reminder_date || "",
        dueDate: (row.due_date != null && String(row.due_date).trim() !== "") ? String(row.due_date).slice(0, 10) : ((row.followup != null && String(row.followup).trim() !== "") ? String(row.followup).slice(0, 10) : ""),
        agingBucket: row.aging_bucket || "",
        assignedAgentId: row.assigned_agent_id || "",
        photo_url: row.photo_url || "",
        aadhaar_photo_url: row.aadhaar_photo_url || "",
        pan_photo_url: row.pan_photo_url || "",
        created_at: row.created_at
    };
}

function mapCustomerToDb(c, shopId) {
    return {
        shop_id: shopId || c.shop_id,
        name: c.name || "",
        product_name: c.productName || "",
        father: c.father || "",
        mobile: c.mobile || "",
        alt_mobile: c.altMobile || "",
        village: c.village || "",
        taluka: c.taluka || "",
        district: c.district || "",
        address: c.address || "",
        aadhaar: c.aadhaar || "",
        pan: c.pan || "",
        bill: Number(c.bill || 0),
        down_payment: Number(c.down || 0),
        outstanding: Number(c.outstanding || 0),
        executive: c.executive || "",
        followup: c.followup || null,
        status: c.status || "Active",
        priority: c.priority || "Low",
        remarks: c.remarks || "",
        auto_reminder: c.autoReminder !== false,
        reminder_interval_days: Number(c.reminderInterval || 3),
        next_reminder_date: c.nextReminderDate || c.followup || null,
        due_date: (c.dueDate !== undefined && c.dueDate !== null && String(c.dueDate).trim() !== "") ? String(c.dueDate).slice(0, 10) : (c.followup ? String(c.followup).slice(0, 10) : null),
        interest_rate_pa: c.interestRatePa ? Number(c.interestRatePa) : null,
        msme_45_day_start: c.msme45DayStart || null,
        msme_45_day_due: c.msme45DayDue || null
    };
}

async function sbGetCustomers() {
    const token=getSession().sessionToken;if(!token)return[];
    const {data,error}=await getSupabase().rpc("app_get_customers",{p_token:token});
    if(error)throw error;return(data||[]).map(mapCustomerFromDb);
}

async function sbSaveCustomer(customer) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const payload=mapCustomerToDb(customer,null);
    delete payload.shop_id;
    const id=customer.id?String(customer.id):null;
    const {data,error}=await getSupabase().rpc("app_save_customer",{
      p_token:token,p_customer_id:id,p_payload:payload
    });
    if(error)throw error;return mapCustomerFromDb(data);
}

async function sbDeleteCustomer(id) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {error}=await getSupabase().rpc("app_delete_customer",{p_token:token,p_customer_id:id});
    if(error)throw error;return true;
}

/* ---------- RECOVERIES ---------- */
function mapRecoveryFromDb(row) {
    if (!row) return null;
    return {
        id: row.id,
        shop_id: row.shop_id,
        customerId: row.customer_id,
        amount: Number(row.amount || 0),
        date: row.recovery_date || "",
        paymentMode: row.payment_mode || "Cash",
        receiptNo: row.receipt_no || "",
        collectedBy: row.collected_by || "",
        remarks: row.remarks || "",
        created_at: row.created_at
    };
}

async function sbGetRecoveries() {
    const token=getSession().sessionToken;if(!token)return[];
    const {data,error}=await getSupabase().rpc("app_get_recoveries",{p_token:token});
    if(error)throw error;return(data||[]).map(mapRecoveryFromDb);
}

async function sbSaveRecovery(recovery) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const payload={customer_id:recovery.customerId,amount:Number(recovery.amount||0),
      recovery_date:(recovery.date||"").toString().slice(0,10),
      payment_mode:recovery.paymentMode||"Cash",receipt_no:recovery.receiptNo||"",
      collected_by:recovery.collectedBy||"",remarks:recovery.remarks||"",
      request_key:recovery.requestKey||""};
    const {data,error}=await getSupabase().rpc("app_save_recovery",{p_token:token,p_payload:payload});
    if(error)throw error;return mapRecoveryFromDb(data);
}

async function sbDeleteRecovery(id) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {error}=await getSupabase().rpc("app_delete_recovery",{p_token:token,p_recovery_id:id});
    if(error)throw error;return true;
}

async function sbUpdateCustomerOutstanding() {
    throw new Error("Outstanding is maintained atomically by the recovery service");
}

/* ---------- USERS ---------- */
async function sbGetUsers() {
    const token=getSession().sessionToken;if(!token)return[];
    const {data,error}=await getSupabase().rpc("app_get_users",{p_token:token});
    if(error)throw error;return data||[];
}

async function sbAddUser(user) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_create_user",{p_token:token,p_payload:{
      username:user.username,password:user.password,role:user.role||"user",
      shop_id:user.shop_id||currentShopId(),display_name:user.display_name||user.username
    }});
    if(error)throw error;return data;
}

async function sbDeleteUser(userId) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {error}=await getSupabase().rpc("app_delete_user",{p_token:token,p_user_id:userId});
    if(error)throw error;return true;
}

async function sbResetUserPassword(userId,newPassword) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_admin_reset_user_password",{
      p_token:token,p_user_id:userId,p_new_password:newPassword||""
    });
    if(error)throw error;return data;
}
window.sbResetUserPassword=sbResetUserPassword;

async function sbResetPasswordByRecovery(username,recoveryEmail,newPassword) {
    const {data,error}=await getSupabase().rpc("app_reset_password_by_recovery",{
      p_username:username||"",p_recovery_email:recoveryEmail||"",p_new_password:newPassword||""
    });
    if(error)throw error;if(data&&data.error)throw new Error(data.error);return data;
}
window.sbResetPasswordByRecovery=sbResetPasswordByRecovery;

async function sbUpdateUserPassword() {
    throw new Error("Use secure profile update");
}

async function sbUpdateUsername() {
    throw new Error("Use secure profile update");
}

/* ---------- SETTINGS ---------- */
async function sbUpdateOwnProfile(currentPassword,newUsername,newPassword,recoveryEmail) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_update_own_profile",{
      p_token:token,p_current_password:currentPassword||"",p_username:newUsername||"",
      p_new_password:newPassword||"",p_recovery_email:recoveryEmail||""
    });
    if(error)throw error;return data;
}
window.sbUpdateOwnProfile=sbUpdateOwnProfile;

async function sbGetSettings() {
    const token=getSession().sessionToken;if(!token)return{};
    const {data,error}=await getSupabase().rpc("app_get_settings",{p_token:token});
    if(error)throw error;
    const row=data||{};let extra=row.extra||{};
    if(typeof extra==="string"){try{extra=JSON.parse(extra)}catch(e){extra={}}}
    return {company:row.company_name||"",softwareName:"Recountix",phone:row.phone||"",
      email:row.email||"",address:row.address||"",logoDataUrl:row.logo_data_url||"",
      preferences:extra.preferences||{},recoveryEmail:row.recovery_email||"",upiId:extra.upi_id||"",website:extra.website||"",
      executives:Array.isArray(extra.executives)?extra.executives:["Mukesh","Bharat","Office"]};
}

async function sbSaveSettings(shopId,settingsObj) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_save_settings",{p_token:token,p_payload:{
      company:settingsObj.company||"",phone:settingsObj.phone||"",email:settingsObj.email||"",
      address:settingsObj.address||"",logoDataUrl:settingsObj.logoDataUrl||"",
      recoveryEmail:settingsObj.recoveryEmail||"",upiId:settingsObj.upiId||"",website:settingsObj.website||"",
      ...(settingsObj.preferences?{preferences:settingsObj.preferences}:{}),executives:Array.isArray(settingsObj.executives)?settingsObj.executives:[]
    }});
    if(error)throw error;return data;
}

/* ---------- SYSTEM MAINTENANCE (Super Admin only) ---------- */
async function sbGetMaintenanceStatus() {
    const { data, error } = await getSupabase().rpc("app_maintenance_status");
    if (error) throw error;
    return { enabled: !!(data && data.enabled), message: (data && data.message) || "" };
}

async function sbSetMaintenanceMode(enabled, message) {
    const token = getSession().sessionToken;
    if (!token) throw new Error("Secure session required");
    const { data, error } = await getSupabase().rpc("app_set_maintenance", {
        p_token: token, p_enabled: !!enabled, p_message: message || ""
    });
    if (error) throw error;
    return data;
}

/* ---------- BULK IMPORT ---------- */
async function __records(action,payload){const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");const {data,error}=await getSupabase().rpc("app_records",{p_token:token,p_action:action,p_payload:payload||{}});if(error)throw error;return data;}
async function sbBulkInsertCustomers(list){
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const rows=list.map(c=>{const x=mapCustomerToDb(c,null);delete x.shop_id;return x});
    const {data,error}=await getSupabase().rpc("app_bulk_customers",{p_token:token,p_rows:rows});
    if(error)throw error;return(data||[]).map(mapCustomerFromDb);
}

/* ---------- STATUS UI ---------- */
function updateSupabaseStatusUI(online, text) {
    const el = document.getElementById("firebaseStatus");
    if (el) {
        el.textContent = text || (online ? "Online" : "Offline");
        el.style.color = online ? "#16a34a" : "#ef4444";
    }
    const badge = document.getElementById("dbStatusBadge");
    if (badge) {
        badge.textContent = online ? "Supabase Online" : "Offline";
        badge.className = online ? "badge badge-success" : "badge badge-warning";
    }
}

async function supabaseBoot() {
    const sb=getSupabase();if(!sb){updateSupabaseStatusUI(false,"SDK Missing");return false;}
    const {error}=await sb.rpc("app_maintenance_status");
    updateSupabaseStatusUI(!error,error?"Error":"Connected");return !error;
}

// Export
window.sbGetShops = sbGetShops;
window.sbGetCustomers = sbGetCustomers;
window.sbSaveCustomer = sbSaveCustomer;
window.sbDeleteCustomer = sbDeleteCustomer;
window.sbGetRecoveries = sbGetRecoveries;
window.sbSaveRecovery = sbSaveRecovery;
window.sbDeleteRecovery = sbDeleteRecovery;
window.sbUpdateCustomerOutstanding = sbUpdateCustomerOutstanding;
window.sbGetUsers = sbGetUsers;
window.sbAddUser = sbAddUser;
window.sbDeleteUser = sbDeleteUser;
window.sbUpdateUserPassword = sbUpdateUserPassword;
window.sbUpdateUsername = sbUpdateUsername;
window.sbGetSettings = sbGetSettings;
window.sbSaveSettings = sbSaveSettings;
window.sbGetMaintenanceStatus = sbGetMaintenanceStatus;
window.sbSetMaintenanceMode = sbSetMaintenanceMode;
window.sbBulkInsertCustomers = sbBulkInsertCustomers;
window.supabaseBoot = supabaseBoot;
window.mapCustomerFromDb = mapCustomerFromDb;
window.mapRecoveryFromDb = mapRecoveryFromDb;

/* ---------- COMPANY / SHOP REGISTRATION ---------- */
async function sbRegisterShop() {
    throw new Error("Public company registration is disabled. Use Super Admin Company Management.");
}

window.sbRegisterShop = sbRegisterShop;

/* ==========================================================
   SUPER ADMIN MODULE
   Business Management, tenant businesses, Subscriptions,
   Audit Log, System-wide Dashboard
========================================================== */

/* ---------- AUDIT LOG ---------- */
async function sbAddAuditLog(action,entityType,entityId,details) {
    try{
      const token=getSession().sessionToken;if(!token)return;
      const {error}=await getSupabase().rpc("app_add_audit",{p_token:token,p_action:action||"",
        p_entity_type:entityType||"",p_entity_id:entityId?String(entityId):"",p_details:details||""});
      if(error)throw error;
    }catch(e){console.error("audit log failed",e)}
}

async function sbGetAuditLog(limit) {
    const token=getSession().sessionToken;if(!token)return[];
    const {data,error}=await getSupabase().rpc("app_get_audit",{p_token:token,p_limit:limit||100});
    if(error)throw error;return data||[];
}

/* ---------- SHOPS (full, incl. inactive) ---------- */
async function __superAdmin(action,payload) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_superadmin",{p_token:token,p_action:action,p_payload:payload||{}});
    if(error)throw error;return data;
}
async function sbGetAllShopsFull(){return(await __superAdmin("shops",{}))||[];}

async function __setBusinessType(shopId,businessType){
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_set_business_type",{
      p_token:token,p_shop_id:shopId,p_business_type:businessType||"Other"
    });
    if(error)throw error;return data;
}
async function sbAddShop(form){
    const created=await __superAdmin("create_shop",form);
    return created&&created.id?await __setBusinessType(created.id,form.businessType):created;
}

async function sbUpdateShop(shopId,form){
    await __superAdmin("update_shop",{...form,id:shopId});
    return await __setBusinessType(shopId,form.businessType);
}

async function sbToggleShopActive(shopId,isActive){return await __superAdmin("toggle_shop",{id:shopId,is_active:!!isActive});}

async function sbDeleteShop(shopId){await __superAdmin("delete_shop",{id:shopId});return true;}

/* ---------- SUBSCRIPTIONS ---------- */
function getEffectiveLicenseExpiry(shop, sub) {
    const a = shop && shop.license_expiry ? String(shop.license_expiry).slice(0, 10) : "";
    const b = sub && sub.end_date ? String(sub.end_date).slice(0, 10) : "";
    if (a && b) return a >= b ? a : b;
    return b || a || "";
}

function computeSubStatus(endDate) {
    if (!endDate) return "unknown";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    if (isNaN(end.getTime())) return "unknown";
    end.setHours(0, 0, 0, 0);
    const days = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    if (days < 0) return "expired";
    if (days <= 15) return "expiring";
    return "active";
}

async function sbGetSubscriptionsWithShops(){
    const rows=(await __superAdmin("subscriptions",{}))||[];
    return rows.map(x=>({...x,liveStatus:computeSubStatus(x.endDate)}));
}

async function sbRenewSubscription(shopId,form){
    return await __superAdmin("renew",{...form,shop_id:shopId});
}

/* ---------- SUPER ADMIN DASHBOARD STATS ---------- */
async function sbGetSuperDashboardStats(){return await __superAdmin("stats",{});}

window.sbAddAuditLog = sbAddAuditLog;
window.sbGetAuditLog = sbGetAuditLog;
window.sbGetAllShopsFull = sbGetAllShopsFull;
window.sbAddShop = sbAddShop;
window.sbUpdateShop = sbUpdateShop;
window.sbToggleShopActive = sbToggleShopActive;
window.sbDeleteShop = sbDeleteShop;
window.computeSubStatus = computeSubStatus;
window.sbGetSubscriptionsWithShops = sbGetSubscriptionsWithShops;
window.sbRenewSubscription = sbRenewSubscription;
window.sbGetSuperDashboardStats = sbGetSuperDashboardStats;


async function sbMarkReminderSent(customerId,nextDate) {
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {error}=await getSupabase().rpc("app_mark_reminder",{p_token:token,p_customer_id:customerId,p_next_date:nextDate||null});
    if(error)throw error;return true;
}
window.sbMarkReminderSent = sbMarkReminderSent;

window.getEffectiveLicenseExpiry = getEffectiveLicenseExpiry;

/* ---------- AGING SUMMARY (RPC) ---------- */
async function sbGetAgingSummary(){
 const token=getSession().sessionToken;if(!token)return{};
 const {data,error}=await getSupabase().rpc("app_aging",{p_token:token,p_action:"summary"});if(error)throw error;
 const row=data||{};return {total_customers:Number(row.total_customers||0),total_outstanding:Number(row.total_outstanding||0),
 bucket_0_30:Number(row.bucket_0_30||0),bucket_31_60:Number(row.bucket_31_60||0),bucket_61_90:Number(row.bucket_61_90||0),
 bucket_90_plus:Number(row.bucket_90_plus||0),total_overdue:Number(row.total_overdue||0),open_ptp:Number(row.open_ptp||0),
 open_escalations:Number(row.open_escalations||0)};
}
window.sbGetAgingSummary = sbGetAgingSummary;

async function sbRecalcAging(){
 const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
 const {data,error}=await getSupabase().rpc("app_aging",{p_token:token,p_action:"recalc"});if(error)throw error;return data;
}
window.sbRecalcAging = sbRecalcAging;

/* ---------- PROMISE TO PAY ---------- */
async function __collection(action,payload){const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");const {data,error}=await getSupabase().rpc("app_collection",{p_token:token,p_action:action,p_payload:payload||{}});if(error)throw error;return data;}
async function sbGetPtp(shopId,status){return(await __collection("ptp_list",{status:status||"all"}))||[];}

async function sbSavePtp(row){return await __collection("ptp_save",{id:row.id||null,customer_id:row.customer_id,agent_id:row.agent_id||null,promised_amount:Number(row.promised_amount||0),promised_date:row.promised_date,notes:row.notes||""});}

async function sbUpdatePtpStatus(id,status,extra){return await __collection("ptp_status",{id,status,kept_recovery_id:extra&&extra.kept_recovery_id||null});}

async function sbDeletePtp(id){await __collection("ptp_delete",{id});return true;}

window.sbGetPtp = sbGetPtp;
window.sbSavePtp = sbSavePtp;
window.sbUpdatePtpStatus = sbUpdatePtpStatus;
window.sbDeletePtp = sbDeletePtp;

/* ---------- PHASE 2: Payment links, receipts, escalations, agents ---------- */
async function sbCreatePaymentLinkRow(row){return await __records("payment_link_add",row);}

async function sbSaveReceiptRow(row){return await __records("receipt_add",row);}

async function sbGetEscalations(shopId,status){return(await __collection("escalation_list",{status:status||"all"}))||[];}

async function sbUpdateEscalation(id,patch){return await __collection("escalation_update",{...patch,id});}

async function sbAssignAgent(customerId,agentId,executiveName){return await __records("assign_agent",{customer_id:customerId,agent_id:agentId||null,executive:executiveName||""});}

window.sbCreatePaymentLinkRow = sbCreatePaymentLinkRow;
window.sbSaveReceiptRow = sbSaveReceiptRow;
window.sbGetEscalations = sbGetEscalations;
window.sbUpdateEscalation = sbUpdateEscalation;
window.sbAssignAgent = sbAssignAgent;

/* ---------- PHASE 3: Activity log + analytics helpers ---------- */
async function sbAddActivity(row){return await __records("activity_add",row);}

async function sbGetActivities(shopId,limit){return(await __records("activity_list",{limit:limit||100}))||[];}

async function sbSaveLegalNotice(row){return await __records("legal_add",row);}

window.sbAddActivity = sbAddActivity;
window.sbGetActivities = sbGetActivities;
window.sbSaveLegalNotice = sbSaveLegalNotice;



async function sbGetActivitiesByAgent(shopId,agentId,limit){return(await __records("activity_list",{agent_id:agentId||null,limit:limit||100}))||[];}
window.sbGetActivitiesByAgent = sbGetActivitiesByAgent;

async function sbSetFieldAgent(userId,isField){return await __records("set_field_agent",{user_id:userId,is_field:!!isField});}
window.sbSetFieldAgent = sbSetFieldAgent;


// Recountix Ad Manager
async function sbGetActiveAds(){
    const token=getSession().sessionToken;if(!token)return[];
    const {data,error}=await getSupabase().rpc('app_active_ads',{p_token:token});
    if(error){console.warn('Ads unavailable',error.message);return[]}
    return data||[];
}
async function sbGetAds(){
    const token=getSession().sessionToken;if(!token)throw new Error('Secure session required');
    const {data,error}=await getSupabase().rpc('app_manage_ads',{p_token:token,p_action:'list',p_payload:{}});
    if(error)throw error;return data||[];
}
async function sbSaveAd(ad){
    const token=getSession().sessionToken;if(!token)throw new Error('Secure session required');
    const payload={...ad,target_shop_id:ad.target_type==='shop'?(ad.target_shop_id||null):null};
    const {data,error}=await getSupabase().rpc('app_manage_ads',{
      p_token:token,p_action:ad.id?'update':'create',p_payload:payload
    });if(error)throw error;return data;
}
async function sbDeleteAd(id){
    const token=getSession().sessionToken;if(!token)throw new Error('Secure session required');
    const {error}=await getSupabase().rpc('app_manage_ads',{p_token:token,p_action:'delete',p_payload:{id}});
    if(error)throw error;
}
async function sbTrackAdClick(id){try{const token=getSession().sessionToken;if(token)await getSupabase().rpc('app_ad_click',{p_token:token,p_ad_id:id});}catch(e){}}
window.sbGetActiveAds=sbGetActiveAds;window.sbGetAds=sbGetAds;window.sbSaveAd=sbSaveAd;window.sbDeleteAd=sbDeleteAd;window.sbTrackAdClick=sbTrackAdClick;


/* ---------- OFFLINE BUSINESS BACKUP ---------- */
async function sbExportBusinessBackup(shopId) {
    const token=getSession().sessionToken;
    if(!token) throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_backup_export",{
        p_token:token,p_shop_id:shopId||null
    });
    if(error) throw error;
    return data;
}
async function sbRestoreBusinessBackup(backup) {
    const token=getSession().sessionToken;
    if(!token) throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_backup_restore",{
        p_token:token,p_backup:backup
    });
    if(error) throw error;
    return data;
}
window.sbExportBusinessBackup=sbExportBusinessBackup;
window.sbRestoreBusinessBackup=sbRestoreBusinessBackup;

async function sbModifyRecovery(id, expectedAmount, payload) {
 const {data,error}=await getSupabase().rpc('app_update_recovery',{
  p_token:getSession().sessionToken,p_recovery_id:id,p_expected_amount:expectedAmount,p_payload:payload
 });
 if(error)throw error;
 return mapRecoveryFromDb(data);
}


async function sbSetCustomerPortalPin(customerId,pin){const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");const{data,error}=await getSupabase().rpc("app_set_customer_portal_pin",{p_token:token,p_customer_id:customerId,p_pin:pin||""});if(error)throw error;return data;}window.sbSetCustomerPortalPin=sbSetCustomerPortalPin;



/* ---------- RECOVERY COMMAND CENTER LIVE METRICS ---------- */
function __rxDateOnly(value){return (value||"").toString().slice(0,10);}
function __rxDaysBetween(from,to){
    const a=new Date(__rxDateOnly(from)), b=new Date(__rxDateOnly(to));
    if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime()))return null;
    a.setHours(0,0,0,0);b.setHours(0,0,0,0);
    return Math.floor((b-a)/86400000);
}
function __rxAgingSummary(customers){
    const today=new Date().toISOString().slice(0,10);
    const out={total_customers:0,total_outstanding:0,bucket_0_30:0,bucket_31_60:0,bucket_61_90:0,bucket_90_plus:0,count_0_30:0,count_31_60:0,count_61_90:0,count_90:0,msme_watch:0};
    (customers||[]).forEach(c=>{
        const amount=Number(c.outstanding||c.balance||0);
        if(amount<=0)return;
        out.total_customers+=1;out.total_outstanding+=amount;
        const due=__rxDateOnly(c.dueDate||c.due_date||c.followup||c.created_at);
        const days=due?Math.max(0,__rxDaysBetween(due,today)||0):0;
        if(days<=30){out.bucket_0_30+=amount;out.count_0_30+=1;}
        else if(days<=60){out.bucket_31_60+=amount;out.count_31_60+=1;}
        else if(days<=90){out.bucket_61_90+=amount;out.count_61_90+=1;}
        else{out.bucket_90_plus+=amount;out.count_90+=1;}
        const msmeStart=__rxDateOnly(c.msme45DayStart||c.msme_45_day_start||due);
        const msmeDays=msmeStart?(__rxDaysBetween(msmeStart,today)||0):0;
        if(msmeDays>=35&&msmeDays<=45)out.msme_watch+=1;
    });
    return out;
}
async function sbGetRecoveryExecMetrics(){
    const today=new Date();
    const todayISO=today.toISOString().slice(0,10);
    const monthPrefix=todayISO.slice(0,7);
    const [customers,recoveries,ptpRows]=await Promise.all([
        sbGetCustomers().catch(()=>[]),
        sbGetRecoveries().catch(()=>[]),
        (typeof sbGetPtp==="function"?sbGetPtp(null,"open"):Promise.resolve([])).catch(()=>[])
    ]);
    const aging=__rxAgingSummary(customers);
    const recoveredThisMonth=(recoveries||[]).reduce((sum,r)=>{
        const d=__rxDateOnly(r.date||r.recovery_date||r.created_at);
        return d.slice(0,7)===monthPrefix?sum+Number(r.amount||0):sum;
    },0);
    let ptp7=0,ptp15=0,ptp30=0,brokenPtp=0,brokenPtpCount=0;
    (ptpRows||[]).forEach(p=>{
        const date=__rxDateOnly(p.promised_date||p.ptp_date||p.date);
        const amount=Number(p.promised_amount||p.ptp_amount||p.amount||0);
        const diff=date?__rxDaysBetween(todayISO,date):null;
        if(diff!==null&&diff>=0&&amount>0){
            if(diff<=7)ptp7+=amount;
            if(diff<=15)ptp15+=amount;
            if(diff<=30)ptp30+=amount;
        }
        if(diff!==null&&diff<0&&amount>0){brokenPtp+=amount;brokenPtpCount+=1;}
    });
    const elapsed=Math.max(1,today.getDate());
    const dso=recoveredThisMonth>0?Math.round((aging.total_outstanding/(recoveredThisMonth/elapsed))*10)/10:null;
    return {aging,recoveredThisMonth,dso,ptp7,ptp15,ptp30,brokenPtp,brokenPtpCount};
}
async function sbMarkDemandNoticeSent(customerId){
    const token=getSession().sessionToken;if(!token)throw new Error("Secure session required");
    const {data,error}=await getSupabase().rpc("app_mark_demand_notice_sent",{p_customer_id:customerId});
    if(error)throw error;return data;
}
window.sbGetRecoveryExecMetrics=sbGetRecoveryExecMetrics;
window.sbMarkDemandNoticeSent=sbMarkDemandNoticeSent;
window.__rxAgingSummary=__rxAgingSummary;
