CREATE OR REPLACE FUNCTION public.app_save_settings(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype; v_row public.settings%rowtype; v_extra jsonb; v_prefs jsonb; v_key text; v_allowed jsonb := '{"autoLogout":["5","10","15","30","60"],"sessionTimeout":["30","60","120","240"],"currency":["INR"],"dateFormat":["dd-mm-yyyy","mm-dd-yyyy","yyyy-mm-dd"],"notifications":["on","off"],"autoBackup":["daily","weekly","monthly","off"]}'::jsonb;
begin
  perform public.app_require_permission(p_token,'settings');
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.shop_id is null then raise exception 'access_denied'; end if;
  if p_payload ? 'preferences' then
    if jsonb_typeof(p_payload->'preferences') <> 'object' then raise exception 'invalid_preferences'; end if;
    v_prefs := '{"autoLogout":"15","sessionTimeout":"60","currency":"INR","dateFormat":"dd-mm-yyyy","notifications":"on","autoBackup":"daily"}'::jsonb || (p_payload->'preferences');
    for v_key in select jsonb_object_keys(v_prefs) loop
      if not (v_allowed ? v_key) or not ((v_allowed->v_key) ? (v_prefs->>v_key)) then raise exception 'invalid_preferences'; end if;
    end loop;
  end if;
  v_extra:=coalesce((select extra from public.settings where shop_id=v_user.shop_id),'{}'::jsonb)||jsonb_build_object('executives',
    case when jsonb_typeof(p_payload->'executives')='array' then p_payload->'executives' else '[]'::jsonb end,
    'upi_id',left(coalesce(p_payload->>'upiId',''),150),
    'website',left(coalesce(p_payload->>'website',''),500));
  if v_prefs is not null then v_extra := v_extra || jsonb_build_object('preferences',v_prefs); end if;
  insert into public.settings(shop_id,company_name,software_name,phone,email,address,logo_data_url,recovery_email,extra,updated_at)
  values(v_user.shop_id,left(coalesce(p_payload->>'company',''),150),'Recountix',
    left(coalesce(p_payload->>'phone',''),30),left(coalesce(p_payload->>'email',''),254),
    left(coalesce(p_payload->>'address',''),1000),nullif(p_payload->>'logoDataUrl',''),
    left(coalesce(p_payload->>'recoveryEmail',''),254),v_extra,now())
  on conflict(shop_id) do update set company_name=excluded.company_name,software_name='Recountix',
    phone=excluded.phone,email=excluded.email,address=excluded.address,logo_data_url=excluded.logo_data_url,
    recovery_email=excluded.recovery_email,extra=excluded.extra,updated_at=now()
  returning * into v_row;
  insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
  values(v_user.shop_id,v_user.id,v_user.username,'settings.update','settings',v_user.shop_id::text,'Shop settings updated');
  if v_prefs is not null then
    update public.app_sessions s set expires_at=least(s.expires_at,s.created_at+make_interval(mins => (v_prefs->>'sessionTimeout')::int))
      from public.users u where u.id=s.user_id and u.shop_id=v_user.shop_id and s.revoked_at is null;
  end if;
  return to_jsonb(v_row);
end $function$;
-- Bound new sessions on the server; existing sessions are never extended.
create or replace function public.app_bound_session_duration() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_minutes text;
begin
 select st.extra->'preferences'->>'sessionTimeout' into v_minutes
 from public.users u join public.settings st on st.shop_id=u.shop_id where u.id=new.user_id;
 if v_minutes in ('30','60','120','240') then
   new.expires_at:=least(new.expires_at,new.created_at+make_interval(mins=>v_minutes::int));
 end if;
 return new;
end;
$$;
revoke all on function public.app_bound_session_duration() from public, anon, authenticated;
create trigger app_session_duration before insert on public.app_sessions
for each row execute function public.app_bound_session_duration();
