-- Synthetic feature coverage. Always execute inside BEGIN / ROLLBACK.
do $test$
declare
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();sa uuid:=gen_random_uuid();
 token text:='audit-owner-'||gen_random_uuid();satoken text:='audit-super-'||gen_random_uuid();ftoken text;
 suffix text:=replace(gen_random_uuid()::text,'-','');c uuid;other_c uuid;rid uuid;pid uuid;eid uuid;adid uuid;
 result jsonb;backup jsonb;payload jsonb;code text;v_hash text;i integer;
begin
 insert into public.shops(id,name,code,is_active,license_expiry) values
 (a,'Audit A','AUDITA'||left(suffix,8),true,current_date+30),(b,'Audit B','AUDITB'||left(suffix,8),true,current_date+30);
 insert into public.users(id,username,password,role,shop_id,display_name,is_active,is_field_agent) values
 (owner,'audit-owner-'||left(suffix,8),extensions.crypt('SyntheticOnly!42',extensions.gen_salt('bf',4)),'admin',a,'Audit Admin',true,false),
 (staff,'audit-staff-'||left(suffix,8),'unused','user',a,'Audit Agent',true,true),
 (sa,'audit-super-'||left(suffix,8),'unused','super_admin',null,'Audit Super',true,false);
 insert into public.app_sessions(user_id,token_hash,expires_at) values
 (owner,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '1 hour'),
 (sa,encode(extensions.digest(satoken,'sha256'),'hex'),now()+interval '1 hour');
 perform pg_temp.check_true('Business login works', public.app_login('audit-owner-'||left(suffix,8),'SyntheticOnly!42') ? 'token');
 result:=public.app_save_customer(token,null,'{"name":"Audit Customer","mobile":"9999999991","bill":1000,"down_payment":100,"outstanding":1,"executive":"Audit Agent","due_date":"2026-09-01"}');
 c:=(result->>'id')::uuid;
 perform pg_temp.check_true('Server computes starting balance',(result->>'outstanding')::numeric=900);
 payload:=jsonb_build_object('customer_id',c,'amount',600,'payment_mode','Cash','recovery_date',current_date,'request_key',suffix);
 result:=public.app_save_recovery(token,payload);rid:=(result->>'id')::uuid;
 perform pg_temp.check_true('Payment balance',(select outstanding=300 from customers where id=c));
 perform pg_temp.check_true('Idempotent retry when balance lower than original payment',(public.app_save_recovery(token,payload)->>'id')::uuid=rid);
 perform pg_temp.check_true('Retry did not double collect',(select outstanding=300 from customers where id=c));
 perform pg_temp.expect_denied('Overcollection',format('select public.app_save_recovery(%L,%L::jsonb)',token,payload||'{"amount":400,"request_key":"another"}'),'amount_exceeds_outstanding');
 perform pg_temp.expect_denied('NaN payment',format('select public.app_save_recovery(%L,%L::jsonb)',token,payload||'{"amount":"NaN"}'),'invalid_amount');
 perform pg_temp.expect_denied('Payment precision',format('select public.app_save_recovery(%L,%L::jsonb)',token,payload||'{"amount":0.001}'),'amount_requires_two_decimals');
 perform pg_temp.expect_denied('Invalid payment mode',format('select public.app_save_recovery(%L,%L::jsonb)',token,payload||'{"amount":1,"payment_mode":"Unknown"}'),'invalid_payment_mode');
 perform public.app_save_customer(token,c,'{"name":"Audit Customer","mobile":"9999999991","bill":1200,"down_payment":200,"executive":"Audit Agent","due_date":"2026-09-01"}');
 perform pg_temp.check_true('Bill edit reconciles existing payments',(select outstanding=400 from customers where id=c));
 perform pg_temp.expect_denied('Bill below payments',format('select public.app_save_customer(%L,%L,%L::jsonb)',token,c,'{"name":"Audit Customer","mobile":"9999999991","bill":100,"down_payment":0}'),'bill_below_paid_amount');
 perform public.app_save_settings(token,'{"company":"Audit A","executives":["Audit Agent"],"upiId":"audit@upi","website":"https://example.test"}');
 perform pg_temp.check_true('UPI settings round trip',public.app_get_settings(token)->'extra'->>'upi_id'='audit@upi');
 perform pg_temp.check_true('Website settings round trip',public.app_get_settings(token)->'extra'->>'website'='https://example.test');
 result:=public.app_collection(token,'ptp_save',jsonb_build_object('customer_id',c,'agent_id',owner,'promised_amount',100,'promised_date',current_date-5,'notes','Audit PTP'));pid:=(result->>'id')::uuid;
 perform pg_temp.check_true('PTP list works',jsonb_array_length(public.app_collection(token,'ptp_list','{"status":"all"}'))=1);
 perform public.app_collection(token,'ptp_status',jsonb_build_object('id',pid,'status','broken'));
 select id into eid from public.escalations where customer_id=c and shop_id=a;
 perform pg_temp.check_true('Broken promise creates escalation',eid is not null);
 perform public.app_collection(token,'escalation_update',jsonb_build_object('id',eid,'status','dismissed'));
 perform pg_temp.check_true('Dismiss escalation works',(select status='dismissed' from escalations where id=eid));
 perform public.app_records(token,'activity_add',jsonb_build_object('customer_id',c,'activity_type','call','notes','Audit activity'));
 perform pg_temp.check_true('Activity list works',jsonb_array_length(public.app_records(token,'activity_list','{}'))=1);
 perform public.app_records(token,'payment_link_add',jsonb_build_object('customer_id',c,'amount',100,'gateway','upi','qr_data','upi://pay?pa=audit@upi'));
 perform pg_temp.check_true('Payment link record works',exists(select 1 from payment_links where customer_id=c));
 perform public.app_records(token,'receipt_add',jsonb_build_object('recovery_id',rid,'customer_id',c,'amount',600));
 perform pg_temp.check_true('Receipt works',exists(select 1 from receipts where recovery_id=rid));
 perform public.app_records(token,'legal_add',jsonb_build_object('customer_id',c,'amount_at_issue',400,'notice_type','reminder_letter'));
 perform pg_temp.check_true('Notice record works',exists(select 1 from legal_notices where customer_id=c));
 perform public.app_aging(token,'recalc');
 perform pg_temp.check_true('Aging summary works',(public.app_aging(token,'summary')->>'total_outstanding')::numeric=400);
 backup:=public.app_backup_export(token);
 perform pg_temp.check_true('Backup contains customer',jsonb_array_length(backup->'tables'->'customers')=1);
 perform pg_temp.check_true('Backup restore round trip',(public.app_backup_restore(token,backup)->>'ok')::boolean);
 perform pg_temp.check_true('Restore avoids duplicates',(select count(*)=1 from customers where shop_id=a));
 perform pg_temp.expect_denied('Wrong business restore',format('select public.app_backup_restore(%L,%L::jsonb)',token,backup||jsonb_build_object('shop_id',b)),'shop_mismatch');
 perform public.app_set_customer_portal_pin(token,c,'123456');
 -- A qualified variable avoids the code column ambiguity below.
 result:=public.app_customer_self_view((select sh.code from shops sh where sh.id=a),'9999999991','123456');
 perform pg_temp.check_true('Portal bill balance',(result->>'pending_amount')::numeric=400 and (result->>'paid_amount')::numeric=800);
 perform pg_temp.check_true('Wrong portal PIN hides record',public.app_customer_self_view((select sh.code from shops sh where sh.id=a),'9999999991','999999') ? 'error');
 for i in 1..5 loop
  result:=public.app_customer_self_view((select sh.code from shops sh where sh.id=a),'9999999991','999999');
 end loop;
 perform pg_temp.check_true('Portal rate limit',result->>'error'='temporarily_locked');
 update public.users set recovery_email='audit@example.test' where id=owner;
 select password into v_hash from users where id=owner;
 result:=public.app_reset_password_by_recovery('audit-owner-'||left(suffix,8),'audit@example.test','ChangedOnly!42');
 perform pg_temp.check_true('Email knowledge cannot reset password',result->>'error'='verified_recovery_required' and (select password=v_hash from users where id=owner));
 perform public.app_update_user_access(token,staff,jsonb_build_object('permissions','{"view":true,"add":true,"modify":true,"delete":false,"settings":false,"backup":false,"restore":false}'::jsonb));
 perform public.app_set_agent_credentials(token,staff,'AUDIT'||left(suffix,8),'123456');
 result:=public.app_field_login('AUDIT'||left(suffix,8),'123456');ftoken:=result->>'token';
 perform pg_temp.check_true('Field login works',ftoken is not null);
 perform pg_temp.check_true('Field assigned customer list',(select count(*)=1 from public.app_field_customers(ftoken)));
 perform pg_temp.check_true('Field check-in works',(public.app_field_checkin(ftoken,c,'visit','Synthetic location omitted',null,null)->>'ok')::boolean);
 insert into public.customers(shop_id,name,mobile,bill,down_payment,outstanding) values(b,'Other business','9999999992',100,0,100) returning id into other_c;
 perform pg_temp.check_true('Cross-business field check-in denied',public.app_field_checkin(ftoken,other_c,'visit','Test',null,null)->>'error'='customer_not_assigned');
 result:=public.app_manage_ads(satoken,'create',jsonb_build_object('title','Audit Ad','target_type','all','start_at',now()-interval '1 day','end_at',now()+interval '1 day','is_active',true));adid:=(result->>'id')::uuid;
 perform pg_temp.check_true('Campaign create works',adid is not null);
 perform pg_temp.expect_denied('Business admin cannot manage campaigns',format('select public.app_manage_ads(%L,%L,%L::jsonb)',token,'list','{}'),'access_denied');
 perform pg_temp.check_true('Superadmin stats works',public.app_superadmin(satoken,'stats','{}') ? 'totalShops');
 perform public.app_set_maintenance(satoken,true,'Audit only');
 perform pg_temp.check_true('Maintenance blocks business session',public.app_validate_session(token)->>'error'='maintenance_mode');
 perform pg_temp.check_true('Maintenance permits superadmin',(public.app_validate_session(satoken)->>'valid')::boolean);
 perform pg_temp.check_true('Maintenance blocks field check-in',public.app_field_checkin(ftoken,c,'visit','Test',null,null)->>'error'='invalid_session');
 perform public.app_set_maintenance(satoken,false,'');
 perform public.app_logout(token);
 perform pg_temp.check_true('Logout revokes session',public.app_validate_session(token)->>'valid'='false');
end;
$test$;
select count(*) as tests_passed,bool_and(passed) as all_passed from permission_results;

