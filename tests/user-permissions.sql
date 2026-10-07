-- Run after the migration inside BEGIN / ROLLBACK. All accounts and data are synthetic.
create temporary table permission_results(test text,passed boolean);
create or replace function pg_temp.expect_denied(p_name text,p_sql text,p_error text default 'permission_denied') returns void language plpgsql as $$
begin
 begin
  execute p_sql;
 exception when others then
  if position(p_error in sqlerrm)>0 then insert into permission_results values(p_name,true);return; end if;
  raise exception 'Test % returned unexpected error: %',p_name,sqlerrm;
 end;
 raise exception 'Test % unexpectedly allowed access',p_name;
end $$;
create or replace function pg_temp.check_true(p_name text,p_value boolean) returns void language plpgsql as $$
begin
 if p_value is distinct from true then raise exception 'Test % failed',p_name; end if;
 insert into permission_results values(p_name,true);
end $$;

do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); admin_a uuid:=gen_random_uuid(); user_a uuid:=gen_random_uuid(); user_b uuid:=gen_random_uuid();
 c uuid; other_c uuid; recovery uuid; ptp uuid; result jsonb; full_rights jsonb:='{"view":true,"add":true,"modify":true,"delete":true,"settings":true,"backup":true,"restore":true}';
 view_rights jsonb:='{"view":true,"add":false,"modify":false,"delete":false,"settings":false,"backup":false,"restore":false}';
 suffix text:=replace(gen_random_uuid()::text,'-',''); actor_token text; user_token text; field_token text;
begin
 actor_token:='rx-test-admin-'||suffix;user_token:='rx-test-user-'||suffix;field_token:='rx-test-field-'||suffix;
 insert into public.shops(id,name,code,is_active,license_expiry) values(a,'Permission test A','rxA'||suffix,true,current_date+10),(b,'Permission test B','rxB'||suffix,true,current_date+10);
 insert into public.users(id,username,password,role,shop_id,display_name,is_active,is_field_agent) values
 (admin_a,'rxa'||suffix,'unused-test-hash','admin',a,'Admin',true,false),
 (user_a,'rxu'||suffix,'unused-test-hash','user',a,'Test Agent',true,true),
 (user_b,'rxb'||suffix,'unused-test-hash','user',b,'Other User',true,false);
 insert into public.app_sessions(user_id,token_hash,expires_at) values
 (admin_a,encode(extensions.digest(actor_token,'sha256'),'hex'),now()+interval '1 hour'),
 (user_a,encode(extensions.digest(user_token,'sha256'),'hex'),now()+interval '1 hour');
 insert into public.field_sessions(agent_id,token_hash,expires_at) values(user_a,encode(extensions.digest(field_token,'sha256'),'hex'),now()+interval '1 hour');
 perform pg_temp.expect_denied('NULL session',format('select public.app_get_my_permissions(%L)',null),'invalid_session');
 perform pg_temp.expect_denied('Empty session',format('select public.app_delete_customer(%L,%L)', '',gen_random_uuid()),'invalid_session');
 perform pg_temp.check_true('Existing users keep add', (public.app_get_my_permissions(user_token)->'permissions'->>'add')::boolean);
 perform pg_temp.expect_denied('Default user cannot delete',format('select public.app_delete_customer(%L,%L)',user_token,gen_random_uuid()));
 perform public.app_update_user_access(actor_token,user_a,jsonb_build_object('permissions',view_rights));
 perform pg_temp.expect_denied('Read-only cannot add',format('select public.app_save_customer(%L,null,%L::jsonb)',user_token,'{}'));
 perform pg_temp.expect_denied('Read-only cannot modify',format('select public.app_save_customer(%L,%L,%L::jsonb)',user_token,gen_random_uuid(),'{}'));
 perform pg_temp.expect_denied('Read-only cannot collect',format('select public.app_save_recovery(%L,%L::jsonb)',user_token,'{}'));
 perform pg_temp.expect_denied('Read-only cannot bulk import',format('select public.app_bulk_customers(%L,%L::jsonb)',user_token,'[]'));
 perform pg_temp.expect_denied('Read-only cannot export backup',format('select public.app_backup_export(%L)',user_token));
 perform pg_temp.expect_denied('Read-only cannot restore',format('select public.app_backup_restore(%L,%L::jsonb)',user_token,'{}'));
 perform pg_temp.expect_denied('Read-only cannot change settings',format('select public.app_save_settings(%L,%L::jsonb)',user_token,'{}'));
 perform pg_temp.expect_denied('Read-only cannot change promise',format('select public.app_collection(%L,%L,%L::jsonb)',user_token,'ptp_status','{}'));
 perform pg_temp.expect_denied('Read-only cannot add activity',format('select public.app_records(%L,%L,%L::jsonb)',user_token,'activity_add','{}'));
 perform pg_temp.expect_denied('Read-only cannot field check-in',format('select public.app_field_checkin(%L,%L,%L,%L,null,null)',field_token,gen_random_uuid(),'visit','Test'));
 perform pg_temp.expect_denied('Cannot grant own rights',format('select public.app_update_user_access(%L,%L,%L::jsonb)',user_token,user_a,jsonb_build_object('permissions',full_rights)));
 perform pg_temp.expect_denied('Admin cannot edit another shop',format('select public.app_update_user_access(%L,%L,%L::jsonb)',actor_token,user_b,jsonb_build_object('permissions',full_rights)),'access_denied');
 perform pg_temp.expect_denied('Cannot promote via payload',format('select public.app_update_user_access(%L,%L,%L::jsonb)',actor_token,user_a,jsonb_build_object('permissions',full_rights,'role','admin')),'invalid_user_payload');
 perform pg_temp.expect_denied('Reject string boolean',format('select public.app_update_user_access(%L,%L,%L::jsonb)',actor_token,user_a,jsonb_build_object('permissions',full_rights||'{"delete":"true"}'::jsonb)),'invalid_permissions');
 perform pg_temp.expect_denied('Protect own admin account',format('select public.app_update_user_access(%L,%L,%L::jsonb)',actor_token,admin_a,jsonb_build_object('permissions',view_rights)),'access_denied');
 perform public.app_update_user_access(actor_token,user_a,jsonb_build_object('permissions',full_rights));
 result:=public.app_save_customer(user_token,null,'{"name":"Synthetic customer","mobile":"9999999999","bill":1000,"down_payment":0,"outstanding":1000}'::jsonb);c:=(result->>'id')::uuid;
 perform pg_temp.check_true('Granted Add works',c is not null);
 perform public.app_save_customer(user_token,c,'{"name":"Changed synthetic customer","mobile":"9999999999","bill":1000,"down_payment":0}'::jsonb);
 perform pg_temp.check_true('Granted Modify works',exists(select 1 from public.customers where id=c and name='Changed synthetic customer'));
 result:=public.app_save_recovery(user_token,jsonb_build_object('customer_id',c,'amount',100,'payment_mode','Cash','recovery_date',current_date,'request_key',suffix));recovery:=(result->>'id')::uuid;
 perform pg_temp.check_true('Collection decreases balance',(select outstanding=900 from public.customers where id=c));
 perform public.app_update_recovery(user_token,recovery,100,jsonb_build_object('amount',150,'payment_mode','UPI','recovery_date',current_date));
 perform pg_temp.check_true('Recovery modification reconciles balance',(select outstanding=850 from public.customers where id=c));
 perform pg_temp.expect_denied('Stale recovery change rejected',format('select public.app_update_recovery(%L,%L,100,%L::jsonb)',user_token,recovery,jsonb_build_object('amount',200,'payment_mode','Cash','recovery_date',current_date)),'recovery_changed');
 perform public.app_update_user_access(actor_token,user_a,jsonb_build_object('permissions',view_rights));
 perform pg_temp.expect_denied('Revocation affects existing session immediately',format('select public.app_delete_recovery(%L,%L)',user_token,recovery));
 perform pg_temp.expect_denied('Recovery edit denied after revoke',format('select public.app_update_recovery(%L,%L,150,%L::jsonb)',user_token,recovery,'{}'));
 perform public.app_update_user_access(actor_token,user_a,jsonb_build_object('permissions',full_rights));
 perform public.app_delete_recovery(user_token,recovery);
 perform pg_temp.check_true('Granted Delete restores balance',(select outstanding=1000 from public.customers where id=c));
 insert into public.customers(shop_id,name,mobile,bill,down_payment,outstanding) values(b,'Other business customer','9999999998',1000,0,1000) returning id into other_c;
 perform public.app_delete_customer(user_token,other_c);
 perform pg_temp.check_true('Delete cannot cross business',exists(select 1 from public.customers where id=other_c));
 perform pg_temp.expect_denied('Modify cannot cross business',format('select public.app_save_customer(%L,%L,%L::jsonb)',user_token,other_c,'{"name":"Tamper","mobile":"9999999999"}'),'customer_not_found');
 perform pg_temp.expect_denied('All business rights cannot administer users',format('select public.app_get_user_access(%L)',user_token));
 perform public.app_delete_customer(user_token,c);
 perform pg_temp.check_true('Granted customer Delete works',not exists(select 1 from public.customers where id=c));
 result:=public.app_create_user(actor_token,jsonb_build_object('username','rxnew'||suffix,'password','Synthetic!Password42','role','user'));
 perform pg_temp.check_true('New accounts are view only',public.app_permissions_for_user((result->>'id')::uuid)=view_rights);

 perform public.app_delete_user(actor_token,(result->>'id')::uuid);
 perform pg_temp.check_true('Admin can delete staff account',not exists(select 1 from public.users where id=(result->>'id')::uuid));
 perform public.app_save_settings(user_token,'{"company":"Permission test company","executives":[]}'::jsonb);
 perform pg_temp.check_true('Granted Settings works',exists(select 1 from public.settings where shop_id=a and company_name='Permission test company'));
 perform pg_temp.check_true('Granted Backup works',public.app_backup_export(user_token)->>'format'='recountix-offline-backup');
 perform pg_temp.expect_denied('Granted Restore reaches format validation',format('select public.app_backup_restore(%L,%L::jsonb)',user_token,'{}'),'invalid_backup_format');
 perform public.app_update_user_access(actor_token,user_a,jsonb_build_object('permissions','{"view":false,"add":false,"modify":false,"delete":false,"settings":false,"backup":false,"restore":false}'::jsonb));
 perform pg_temp.expect_denied('View revoked blocks record reads',format('select public.app_get_customers(%L)',user_token));
 perform pg_temp.check_true('View revoked blocks field customer list',(select count(*)=0 from public.app_field_customers(field_token)));
 perform public.app_update_user_access(actor_token,user_a,jsonb_build_object('permissions',full_rights));
 update public.shops set is_active=false where id=a;
 perform pg_temp.expect_denied('Inactive shop cannot mutate',format('select public.app_save_customer(%L,null,%L::jsonb)',user_token,'{}'),'invalid_session');
 update public.shops set is_active=true,license_expiry=current_date-1 where id=a;
 perform pg_temp.expect_denied('Expired shop cannot mutate',format('select public.app_save_customer(%L,null,%L::jsonb)',user_token,'{}'),'invalid_session');
 update public.shops set license_expiry=current_date+10 where id=a;
 perform public.app_update_user_access(actor_token,user_a,jsonb_build_object('permissions',view_rights,'is_active',false));
 perform pg_temp.check_true('Disabling user revokes app sessions',not exists(select 1 from public.app_sessions where user_id=user_a and revoked_at is null));
 perform pg_temp.check_true('Disabling user revokes field sessions',not exists(select 1 from public.field_sessions where agent_id=user_a));
 perform pg_temp.expect_denied('Disabled user cannot read',format('select public.app_get_customers(%L)',user_token),'invalid_session');
 perform pg_temp.check_true('Permission changes audited',exists(select 1 from public.audit_log where entity_id=user_a::text and action='user_access_updated'));
 perform pg_temp.check_true('Anonymous cannot call internal helper',not has_function_privilege('anon','public.app_require_permission(text,text)','execute'));
 perform pg_temp.check_true('Anonymous cannot edit permission table',not has_table_privilege('anon','public.user_permissions','update'));
end $$;
select count(*) as tests_passed,bool_and(passed) as all_passed from permission_results;
