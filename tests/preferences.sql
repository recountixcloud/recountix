do $$
declare shop uuid:=gen_random_uuid(); uid uuid:=gen_random_uuid(); token text:=gen_random_uuid()::text; result jsonb;
begin
 insert into public.shops(id,name,code,is_active,license_expiry) values(shop,'Synthetic preferences','PREF'||replace(gen_random_uuid()::text,'-',''),true,current_date+30);
 insert into public.users(id,username,password,role,shop_id,is_active) values(uid,'pref-'||uid::text,'unused','admin',shop,true);
 insert into public.app_sessions(user_id,token_hash,expires_at) values(uid,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '12 hours');
 perform public.app_save_settings(token,'{"company":"Preference Test","preferences":{"autoLogout":"5","sessionTimeout":"30","dateFormat":"yyyy-mm-dd","notifications":"off","autoBackup":"weekly","currency":"INR"}}');
 result:=public.app_get_settings(token);
 perform pg_temp.check_true('Preferences persist',result->'extra'->'preferences'->>'dateFormat'='yyyy-mm-dd' and result->'extra'->'preferences'->>'autoBackup'='weekly');
 perform pg_temp.check_true('Existing session is bounded',(select expires_at<=created_at+interval '30 minutes' from public.app_sessions where user_id=uid));
 insert into public.app_sessions(user_id,token_hash,expires_at) values(uid,encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),now()+interval '12 hours');
 perform pg_temp.check_true('New session is bounded',(select bool_and(expires_at<=created_at+interval '30 minutes') from public.app_sessions where user_id=uid));
 perform public.app_save_settings(token,'{"company":"Changed without preferences"}');
 perform pg_temp.check_true('Branding save preserves preferences',public.app_get_settings(token)->'extra'->'preferences'->>'autoLogout'='5');
 perform pg_temp.expect_denied('Invalid preference denied',format('select public.app_save_settings(%L,%L::jsonb)',token,'{"preferences":{"sessionTimeout":"9999"}}'),'invalid_preferences');
 perform pg_temp.expect_denied('Unauthenticated settings denied','select public.app_save_settings(''invalid'',''{"preferences":{}}'')','invalid_session');
end $$;
select count(*) tests_passed,bool_and(passed) all_passed from permission_results;
