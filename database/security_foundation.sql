-- Recountix security foundation: server-verified sessions and login throttling.
-- Apply in Supabase SQL Editor before deploying the matching frontend branch.
-- This migration is idempotent and does not yet change application-table RLS.

create extension if not exists pgcrypto;


create table if not exists public.system_config (
  id integer primary key,
  maintenance_mode boolean not null default false,
  maintenance_message text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.system_config(id,maintenance_mode,maintenance_message)
values(1,false,'') on conflict(id) do nothing;

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists app_sessions_user_idx on public.app_sessions(user_id);
create index if not exists app_sessions_expiry_idx on public.app_sessions(expires_at);

create table if not exists public.login_attempts (
  username text primary key,
  failed_count integer not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now()
);

alter table public.app_sessions enable row level security;
alter table public.login_attempts enable row level security;

revoke all on public.app_sessions from anon, authenticated;
revoke all on public.login_attempts from anon, authenticated;

create or replace function public.app_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.users%rowtype;
  v_shop public.shops%rowtype;
  v_attempt public.login_attempts%rowtype;
  v_token text;
  v_valid boolean := false;
  v_maintenance boolean := false;
begin
  if length(trim(coalesce(p_username,''))) < 1 or length(coalesce(p_password,'')) < 1 then
    return jsonb_build_object('error','invalid_credentials');
  end if;

  select * into v_attempt from public.login_attempts
   where username = lower(trim(p_username));
  if found and v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return jsonb_build_object('error','temporarily_locked');
  end if;

  select * into v_user from public.users
   where lower(username) = lower(trim(p_username)) and is_active = true
   limit 1;

  if found then
    if v_user.password like '$2%' then
      v_valid := extensions.crypt(p_password, v_user.password) = v_user.password;
    elsif v_user.password ~ '^[a-f0-9]{64}$' then
      v_valid := encode(extensions.digest('VO-RM-v1-' || p_password, 'sha256'),'hex') = lower(v_user.password);
    end if;
  end if;

  if not v_valid then
    insert into public.login_attempts(username, failed_count, locked_until, last_attempt_at)
    values (lower(trim(p_username)), 1, null, now())
    on conflict (username) do update
      set failed_count = public.login_attempts.failed_count + 1,
          locked_until = case when public.login_attempts.failed_count + 1 >= 5
                              then now() + interval '15 minutes' else null end,
          last_attempt_at = now();
    return jsonb_build_object('error','invalid_credentials');
  end if;

  delete from public.login_attempts where username = lower(trim(p_username));

  select coalesce(maintenance_mode,false) into v_maintenance
  from public.system_config where id = 1;
  if coalesce(v_maintenance,false) and v_user.role <> 'super_admin' then
    return jsonb_build_object('error','maintenance_mode');
  end if;

  if v_user.password !~ '^\\$2' then
    update public.users
       set password = extensions.crypt(p_password, extensions.gen_salt('bf', 12))
     where id = v_user.id;
  end if;

  if v_user.shop_id is not null then
    select * into v_shop from public.shops where id = v_user.shop_id;
    if found and v_shop.is_active = false and v_user.role <> 'super_admin' then
      return jsonb_build_object('error','shop_inactive');
    end if;
    if found and v_shop.license_expiry is not null
       and v_shop.license_expiry < current_date and v_user.role <> 'super_admin' then
      return jsonb_build_object('error','license_expired');
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.app_sessions(token_hash, user_id, expires_at)
  values (encode(extensions.digest(v_token,'sha256'),'hex'), v_user.id, now() + interval '12 hours');

  return jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_user.id, 'username', v_user.username, 'role', v_user.role,
      'shop_id', v_user.shop_id, 'display_name', v_user.display_name
    )
  );
end;
$$;

create or replace function public.app_validate_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.app_sessions%rowtype;
  v_user public.users%rowtype;
  v_shop public.shops%rowtype;
  v_maintenance boolean := false;
begin
  if coalesce(p_token,'') = '' then return jsonb_build_object('valid',false); end if;
  select * into v_session from public.app_sessions
   where token_hash = encode(extensions.digest(p_token,'sha256'),'hex')
     and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('valid',false); end if;

  select * into v_user from public.users where id=v_session.user_id and is_active=true;
  if not found then return jsonb_build_object('valid',false); end if;

  select coalesce(maintenance_mode,false) into v_maintenance
  from public.system_config where id = 1;
  if coalesce(v_maintenance,false) and v_user.role <> 'super_admin' then
    return jsonb_build_object('valid',false,'error','maintenance_mode');
  end if;

  if v_user.shop_id is not null then
    select * into v_shop from public.shops where id = v_user.shop_id;
    if not found and v_user.role <> 'super_admin' then
      return jsonb_build_object('valid',false,'error','invalid_shop');
    end if;
    if found and v_shop.is_active = false and v_user.role <> 'super_admin' then
      return jsonb_build_object('valid',false,'error','shop_inactive');
    end if;
    if found and v_shop.license_expiry is not null
       and v_shop.license_expiry < current_date and v_user.role <> 'super_admin' then
      return jsonb_build_object('valid',false,'error','license_expired');
    end if;
  end if;

  update public.app_sessions set last_seen_at=now() where id=v_session.id;
  return jsonb_build_object(
    'valid',true,
    'user',jsonb_build_object('id',v_user.id,'username',v_user.username,'role',v_user.role,
      'shop_id',v_user.shop_id,'display_name',v_user.display_name),
    'expires_at',v_session.expires_at
  );
end;
$$;

create or replace function public.app_logout(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.app_sessions set revoked_at=now()
   where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null;
$$;

revoke all on function public.app_login(text,text) from public;
revoke all on function public.app_validate_session(text) from public;
revoke all on function public.app_logout(text) from public;
grant execute on function public.app_login(text,text) to anon, authenticated;
grant execute on function public.app_validate_session(text) to anon, authenticated;
grant execute on function public.app_logout(text) to anon, authenticated;

-- Remove obsolete sessions automatically from a scheduled maintenance job:
-- delete from public.app_sessions where expires_at < now() - interval '7 days' or revoked_at is not null;


-- Field agents: PIN verification and customer access stay server-side.
create table if not exists public.field_sessions (
  token_hash text primary key,
  agent_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.field_sessions enable row level security;
revoke all on public.field_sessions from anon, authenticated;

create or replace function public.app_field_login(p_agent_code text, p_pin text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_shop public.shops%rowtype; v_token text; v_key text; v_valid boolean:=false; v_maintenance boolean:=false;
begin
  v_key := 'field:' || lower(trim(coalesce(p_agent_code,'')));
  if length(coalesce(p_pin,'')) < 4 then return jsonb_build_object('error','invalid_credentials'); end if;
  if exists(select 1 from public.login_attempts where username=v_key and locked_until>now()) then
    return jsonb_build_object('error','temporarily_locked');
  end if;
  select * into v_user from public.users where lower(agent_code)=lower(trim(p_agent_code))
    and is_active=true and is_field_agent=true limit 1;
  if found then
    v_valid := (
      (v_user.field_pin like '$2%' and extensions.crypt(p_pin,v_user.field_pin)=v_user.field_pin)
      or (v_user.field_pin !~ '^\\$2' and v_user.field_pin=p_pin)
    );
  end if;
  if v_valid is not true then
    insert into public.login_attempts(username,failed_count,locked_until,last_attempt_at)
    values(v_key,1,null,now()) on conflict(username) do update
      set failed_count=public.login_attempts.failed_count+1,
          locked_until=case when public.login_attempts.failed_count+1>=5 then now()+interval '15 minutes' else null end,
          last_attempt_at=now();
    return jsonb_build_object('error','invalid_credentials');
  end if;
  select coalesce(maintenance_mode,false) into v_maintenance from public.system_config where id=1;
  if coalesce(v_maintenance,false) then return jsonb_build_object('error','maintenance_mode'); end if;
  if v_user.shop_id is null then return jsonb_build_object('error','invalid_shop'); end if;
  select * into v_shop from public.shops where id=v_user.shop_id;
  if not found or v_shop.is_active=false then return jsonb_build_object('error','shop_inactive'); end if;
  if v_shop.license_expiry is not null and v_shop.license_expiry < current_date then
    return jsonb_build_object('error','license_expired');
  end if;
  delete from public.login_attempts where username=v_key;
  if v_user.field_pin !~ '^\\$2' then
    update public.users set field_pin=extensions.crypt(p_pin,extensions.gen_salt('bf',12)) where id=v_user.id;
  end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.field_sessions(token_hash,agent_id,expires_at)
    values(encode(extensions.digest(v_token,'sha256'),'hex'),v_user.id,now()+interval '8 hours');
  return jsonb_build_object('token',v_token,'agent',jsonb_build_object(
    'id',v_user.id,'display_name',v_user.display_name,'username',v_user.username));
end $$;

create or replace function public.app_field_customers(p_token text)
returns table(id uuid,name text,village text)
language sql security definer set search_path=public,pg_temp as $$
  select c.id,c.name,c.village from public.field_sessions fs
  join public.users u on u.id=fs.agent_id
  join public.shops sh on sh.id=u.shop_id and sh.is_active=true
  join public.customers c on c.shop_id=u.shop_id
    and trim(coalesce(c.executive,''))=trim(coalesce(u.display_name,''))
  where fs.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and fs.expires_at>now() and u.is_active=true and u.is_field_agent=true
    and not coalesce((select maintenance_mode from public.system_config where id=1),false)
    and (sh.license_expiry is null or sh.license_expiry>=current_date)
  order by c.name
$$;

create or replace function public.app_field_checkin(
  p_token text,p_customer_id uuid,p_activity_type text,p_notes text,p_lat numeric,p_lng numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_ok boolean;
begin
  select u.* into v_user from public.field_sessions fs join public.users u on u.id=fs.agent_id
   join public.shops sh on sh.id=u.shop_id and sh.is_active=true
   where fs.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and fs.expires_at>now()
     and u.is_active=true and u.is_field_agent=true
     and not coalesce((select maintenance_mode from public.system_config where id=1),false)
     and (sh.license_expiry is null or sh.license_expiry>=current_date);
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select exists(select 1 from public.customers c where c.id=p_customer_id and c.shop_id=v_user.shop_id
    and trim(coalesce(c.executive,''))=trim(coalesce(v_user.display_name,''))) into v_ok;
  if not v_ok then return jsonb_build_object('ok',false,'error','customer_not_assigned'); end if;
  if p_activity_type not in ('visit','call','whatsapp') then
    return jsonb_build_object('ok',false,'error','invalid_activity');
  end if;
  insert into public.agent_activity_log(shop_id,agent_id,customer_id,activity_type,outcome,notes,gps_lat,gps_lng)
  values(v_user.shop_id,v_user.id,p_customer_id,p_activity_type,'field_checkin',
    left(coalesce(p_notes,'Public check-in'),2000),p_lat,p_lng);
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.app_field_login(text,text) from public;
revoke all on function public.app_field_customers(text) from public;
revoke all on function public.app_field_checkin(text,uuid,text,text,numeric,numeric) from public;
grant execute on function public.app_field_login(text,text) to anon,authenticated;
grant execute on function public.app_field_customers(text) to anon,authenticated;
grant execute on function public.app_field_checkin(text,uuid,text,text,numeric,numeric) to anon,authenticated;


-- Maintenance and advertisement authorization.
create or replace function public.app_maintenance_status()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object(
    'enabled',coalesce(maintenance_mode,false),
    'message',coalesce(maintenance_message,''))
    from public.system_config where id=1),
    jsonb_build_object('enabled',false,'message',''))
$$;

create or replace function public.app_set_maintenance(p_token text,p_enabled boolean,p_message text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text;
begin
  select u.role into v_role from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
     and s.revoked_at is null and s.expires_at>now() and u.is_active=true;
  if v_role is distinct from 'super_admin' then raise exception 'access_denied'; end if;
  insert into public.system_config(id,maintenance_mode,maintenance_message,updated_at)
  values(1,coalesce(p_enabled,false),left(coalesce(p_message,''),500),now())
  on conflict(id) do update set maintenance_mode=excluded.maintenance_mode,
    maintenance_message=excluded.maintenance_message,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.app_active_ads(p_token text)
returns setof public.ads language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shop uuid;
begin
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
     and s.revoked_at is null and s.expires_at>now() and u.is_active=true;
  if not found then raise exception 'invalid_session'; end if;
  return query select a.* from public.ads a where a.is_active=true
    and a.start_at<=now() and a.end_at>=now()
    and (a.target_type='all' or (a.target_type='shop' and a.target_shop_id=v_shop))
    order by a.created_at desc;
end $$;

create or replace function public.app_manage_ads(p_token text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_id uuid; v_row public.ads%rowtype;
begin
  select u.role into v_role from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
     and s.revoked_at is null and s.expires_at>now() and u.is_active=true;
  if v_role is distinct from 'super_admin' then raise exception 'access_denied'; end if;
  if p_action='list' then
    return coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.ads a),'[]'::jsonb);
  elsif p_action='delete' then
    v_id:=(p_payload->>'id')::uuid; delete from public.ads where id=v_id;
    return jsonb_build_object('ok',true);
  elsif p_action in ('create','update') then
    if length(trim(coalesce(p_payload->>'title','')))<1 then raise exception 'title_required'; end if;
    if (p_payload->>'end_at')::timestamptz <= (p_payload->>'start_at')::timestamptz then
      raise exception 'invalid_schedule';
    end if;
    if p_action='create' then
      insert into public.ads(title,description,image_url,link_url,cta_text,target_type,target_shop_id,start_at,end_at,is_active)
      values(left(p_payload->>'title',150),left(coalesce(p_payload->>'description',''),500),
        nullif(p_payload->>'image_url',''),nullif(p_payload->>'link_url',''),
        left(coalesce(p_payload->>'cta_text','Learn More'),50),coalesce(p_payload->>'target_type','all'),
        nullif(p_payload->>'target_shop_id','')::uuid,(p_payload->>'start_at')::timestamptz,
        (p_payload->>'end_at')::timestamptz,coalesce((p_payload->>'is_active')::boolean,false))
      returning * into v_row;
    else
      v_id:=(p_payload->>'id')::uuid;
      update public.ads set title=left(p_payload->>'title',150),
        description=left(coalesce(p_payload->>'description',''),500),
        image_url=nullif(p_payload->>'image_url',''),link_url=nullif(p_payload->>'link_url',''),
        cta_text=left(coalesce(p_payload->>'cta_text','Learn More'),50),
        target_type=coalesce(p_payload->>'target_type','all'),
        target_shop_id=nullif(p_payload->>'target_shop_id','')::uuid,
        start_at=(p_payload->>'start_at')::timestamptz,end_at=(p_payload->>'end_at')::timestamptz,
        is_active=coalesce((p_payload->>'is_active')::boolean,false)
       where id=v_id returning * into v_row;
    end if;
    return to_jsonb(v_row);
  end if;
  raise exception 'invalid_action';
end $$;

create or replace function public.app_ad_click(p_token text,p_ad_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.app_sessions s where
    s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now())
    then raise exception 'invalid_session'; end if;
  update public.ads set clicks=clicks+1 where id=p_ad_id and is_active=true
    and start_at<=now() and end_at>=now();
end $$;

revoke all on function public.app_maintenance_status() from public;
revoke all on function public.app_set_maintenance(text,boolean,text) from public;
revoke all on function public.app_active_ads(text) from public;
revoke all on function public.app_manage_ads(text,text,jsonb) from public;
revoke all on function public.app_ad_click(text,uuid) from public;
grant execute on function public.app_maintenance_status() to anon,authenticated;
grant execute on function public.app_set_maintenance(text,boolean,text) to anon,authenticated;
grant execute on function public.app_active_ads(text) to anon,authenticated;
grant execute on function public.app_manage_ads(text,text,jsonb) to anon,authenticated;
grant execute on function public.app_ad_click(text,uuid) to anon,authenticated;

drop policy if exists "ads_public_manage" on public.ads;
drop policy if exists "ads_public_read" on public.ads;
revoke all on public.ads from anon,authenticated;
revoke all on public.system_config from anon,authenticated;


-- Tenant-isolated customer and recovery operations.
alter table public.recoveries add column if not exists request_key text;
create unique index if not exists idx_recoveries_shop_request_key
  on public.recoveries(shop_id,request_key)
  where request_key is not null and request_key <> '';

create or replace function public.app_get_customers(p_token text)
returns setof public.customers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shop uuid;
begin
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then return; end if;
  return query select * from public.customers where shop_id=v_shop order by created_at desc;
end $$;

create or replace function public.app_save_customer(p_token text,p_customer_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shop uuid; v_row public.customers%rowtype;
begin
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then raise exception 'invalid_session'; end if;
  if length(trim(coalesce(p_payload->>'name','')))<1 then raise exception 'name_required'; end if;
  if coalesce(p_payload->>'mobile','') !~ '^[0-9+ -]{10,16}$' then raise exception 'invalid_mobile'; end if;

  if p_customer_id is null then
    insert into public.customers(shop_id,name,product_name,father,mobile,alt_mobile,village,taluka,district,address,
      aadhaar,pan,bill,down_payment,outstanding,executive,followup,status,priority,remarks,auto_reminder,
      reminder_interval_days,next_reminder_date,due_date)
    values(v_shop,left(trim(p_payload->>'name'),150),left(coalesce(p_payload->>'product_name',''),150),
      left(coalesce(p_payload->>'father',''),150),left(p_payload->>'mobile',16),
      left(coalesce(p_payload->>'alt_mobile',''),16),left(coalesce(p_payload->>'village',''),150),
      left(coalesce(p_payload->>'taluka',''),150),left(coalesce(p_payload->>'district',''),150),
      left(coalesce(p_payload->>'address',''),1000),left(coalesce(p_payload->>'aadhaar',''),20),
      left(coalesce(p_payload->>'pan',''),20),greatest(coalesce((p_payload->>'bill')::numeric,0),0),
      greatest(coalesce((p_payload->>'down_payment')::numeric,0),0),
      greatest(coalesce((p_payload->>'outstanding')::numeric,0),0),left(coalesce(p_payload->>'executive',''),150),
      nullif(p_payload->>'followup','')::date,coalesce(p_payload->>'status','Active'),
      coalesce(p_payload->>'priority','Low'),left(coalesce(p_payload->>'remarks',''),2000),
      coalesce((p_payload->>'auto_reminder')::boolean,true),
      greatest(1,least(coalesce((p_payload->>'reminder_interval_days')::int,3),365)),
      nullif(p_payload->>'next_reminder_date','')::date,nullif(p_payload->>'due_date','')::date)
    returning * into v_row;
  else
    update public.customers set name=left(trim(p_payload->>'name'),150),
      product_name=left(coalesce(p_payload->>'product_name',''),150),
      father=left(coalesce(p_payload->>'father',''),150),mobile=left(p_payload->>'mobile',16),
      alt_mobile=left(coalesce(p_payload->>'alt_mobile',''),16),village=left(coalesce(p_payload->>'village',''),150),
      taluka=left(coalesce(p_payload->>'taluka',''),150),district=left(coalesce(p_payload->>'district',''),150),
      address=left(coalesce(p_payload->>'address',''),1000),aadhaar=left(coalesce(p_payload->>'aadhaar',''),20),
      pan=left(coalesce(p_payload->>'pan',''),20),bill=greatest(coalesce((p_payload->>'bill')::numeric,0),0),
      down_payment=greatest(coalesce((p_payload->>'down_payment')::numeric,0),0),
      executive=left(coalesce(p_payload->>'executive',''),150),followup=nullif(p_payload->>'followup','')::date,
      status=coalesce(p_payload->>'status','Active'),priority=coalesce(p_payload->>'priority','Low'),
      remarks=left(coalesce(p_payload->>'remarks',''),2000),
      auto_reminder=coalesce((p_payload->>'auto_reminder')::boolean,true),
      reminder_interval_days=greatest(1,least(coalesce((p_payload->>'reminder_interval_days')::int,3),365)),
      next_reminder_date=nullif(p_payload->>'next_reminder_date','')::date,
      due_date=nullif(p_payload->>'due_date','')::date,updated_at=now()
     where id=p_customer_id and shop_id=v_shop returning * into v_row;
    if not found then raise exception 'customer_not_found'; end if;
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.app_delete_customer(p_token text,p_customer_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shop uuid; v_role text;
begin
  select u.shop_id,u.role into v_shop,v_role from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null or v_role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  delete from public.customers where id=p_customer_id and shop_id=v_shop;
end $$;

create or replace function public.app_get_recoveries(p_token text)
returns setof public.recoveries language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shop uuid;
begin
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then return; end if;
  return query select * from public.recoveries where shop_id=v_shop order by recovery_date desc,created_at desc;
end $$;

create or replace function public.app_save_recovery(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_shop uuid;
  v_customer public.customers%rowtype;
  v_row public.recoveries%rowtype;
  v_amount numeric;
  v_request_key text;
  v_receipt_no text;
begin
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then raise exception 'invalid_session'; end if;
  v_amount:=coalesce((p_payload->>'amount')::numeric,0);
  if v_amount<0 then raise exception 'invalid_amount'; end if;
  select * into v_customer from public.customers where id=(p_payload->>'customer_id')::uuid
    and shop_id=v_shop for update;
  if not found then raise exception 'customer_not_found'; end if;
  if v_amount>v_customer.outstanding then raise exception 'amount_exceeds_outstanding'; end if;
  if v_amount=0 and length(trim(coalesce(p_payload->>'remarks','')))=0 then raise exception 'remarks_required'; end if;
  v_request_key:=left(regexp_replace(coalesce(p_payload->>'request_key',''),'[^A-Za-z0-9._:-]','','g'),120);
  v_receipt_no:=left(coalesce(p_payload->>'receipt_no',''),100);

  if v_request_key<>'' then
    select * into v_row from public.recoveries
     where shop_id=v_shop
       and request_key=v_request_key
     order by created_at desc limit 1;
    if found then return to_jsonb(v_row); end if;
  end if;

  if trim(v_receipt_no)<>'' then
    select * into v_row from public.recoveries
     where shop_id=v_shop
       and customer_id=v_customer.id
       and receipt_no=v_receipt_no
       and created_at>now()-interval '10 minutes'
     order by created_at desc limit 1;
    if found then return to_jsonb(v_row); end if;
  end if;

  insert into public.recoveries(shop_id,customer_id,amount,recovery_date,payment_mode,receipt_no,collected_by,remarks,request_key)
  values(v_shop,v_customer.id,v_amount,coalesce(nullif(p_payload->>'recovery_date','')::date,current_date),
    left(coalesce(p_payload->>'payment_mode','Cash'),30),v_receipt_no,
    left(coalesce(p_payload->>'collected_by',''),150),left(coalesce(p_payload->>'remarks',''),2000),
    nullif(v_request_key,''))
  returning * into v_row;
  update public.customers set outstanding=greatest(0,outstanding-v_amount),
    remarks=case when v_amount=0 then concat_ws(' | ',nullif(remarks,''),
      '['||v_row.recovery_date::text||'] '||left(p_payload->>'remarks',1000)) else remarks end,
    updated_at=now() where id=v_customer.id;
  return to_jsonb(v_row);
end $$;

create or replace function public.app_delete_recovery(p_token text,p_recovery_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shop uuid; v_role text; v_row public.recoveries%rowtype;
begin
  select u.shop_id,u.role into v_shop,v_role from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null or v_role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  select * into v_row from public.recoveries where id=p_recovery_id and shop_id=v_shop for update;
  if not found then raise exception 'recovery_not_found'; end if;
  update public.customers set outstanding=outstanding+v_row.amount,updated_at=now()
   where id=v_row.customer_id and shop_id=v_shop;
  delete from public.recoveries where id=v_row.id;
end $$;

revoke all on function public.app_get_customers(text) from public;
revoke all on function public.app_save_customer(text,uuid,jsonb) from public;
revoke all on function public.app_delete_customer(text,uuid) from public;
revoke all on function public.app_get_recoveries(text) from public;
revoke all on function public.app_save_recovery(text,jsonb) from public;
revoke all on function public.app_delete_recovery(text,uuid) from public;
grant execute on function public.app_get_customers(text) to anon,authenticated;
grant execute on function public.app_save_customer(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.app_delete_customer(text,uuid) to anon,authenticated;
grant execute on function public.app_get_recoveries(text) to anon,authenticated;
grant execute on function public.app_save_recovery(text,jsonb) to anon,authenticated;
grant execute on function public.app_delete_recovery(text,uuid) to anon,authenticated;


-- Secure user management and self-service credential changes.
create or replace function public.app_get_users(p_token text)
returns table(id uuid,username text,role text,shop_id uuid,display_name text,is_active boolean,
  is_field_agent boolean,mobile text,agent_code text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  return query select u.id,u.username,u.role,u.shop_id,u.display_name,u.is_active,
    coalesce(u.is_field_agent,false),u.mobile,u.agent_code from public.users u
    where (v_user.role='super_admin' or u.shop_id=v_user.shop_id)
    order by u.username;
end $$;

create or replace function public.app_create_user(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor public.users%rowtype; v_role text; v_shop uuid; v_row public.users%rowtype; v_password text;
begin
  select u.* into v_actor from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_actor.role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  if coalesce(p_payload->>'username','') !~ '^[A-Za-z0-9._-]{3,50}$' then raise exception 'invalid_username'; end if;
  v_password:=coalesce(p_payload->>'password','');
  if length(v_password)<8 then raise exception 'weak_password'; end if;
  v_role:=coalesce(p_payload->>'role','user');
  if v_role not in ('admin','user') then raise exception 'invalid_role'; end if;
  if v_actor.role='admin' then v_role:='user'; v_shop:=v_actor.shop_id;
  else v_shop:=nullif(p_payload->>'shop_id','')::uuid; end if;
  if v_shop is null or not exists(select 1 from public.shops where id=v_shop) then raise exception 'invalid_shop'; end if;
  insert into public.users(username,password,role,shop_id,display_name,is_active)
  values(trim(p_payload->>'username'),extensions.crypt(v_password,extensions.gen_salt('bf',12)),v_role,v_shop,
    left(coalesce(nullif(trim(p_payload->>'display_name'),''),trim(p_payload->>'username')),150),true)
  returning * into v_row;
  return jsonb_build_object('id',v_row.id,'username',v_row.username,'role',v_row.role,
    'shop_id',v_row.shop_id,'display_name',v_row.display_name,'is_active',v_row.is_active);
end $$;

create or replace function public.app_delete_user(p_token text,p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor public.users%rowtype; v_target public.users%rowtype;
begin
  select u.* into v_actor from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  select * into v_target from public.users where id=p_user_id;
  if not found or v_actor.id=v_target.id or v_target.role='super_admin' then raise exception 'access_denied'; end if;
  if v_actor.role='super_admin' or
     (v_actor.role='admin' and v_target.role='user' and v_target.shop_id=v_actor.shop_id) then
    delete from public.users where id=v_target.id;
  else raise exception 'access_denied'; end if;
end $$;

create or replace function public.app_update_own_profile(
  p_token text,p_current_password text,p_username text,p_new_password text,p_recovery_email text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_valid boolean:=false; v_new_username text;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found then raise exception 'invalid_session'; end if;
  if coalesce(p_current_password,'')='' then raise exception 'invalid_current_password'; end if;
  if v_user.password like '$2%' then v_valid:=extensions.crypt(p_current_password,v_user.password)=v_user.password;
  elsif v_user.password ~ '^[a-f0-9]{64}$' then
    v_valid:=encode(extensions.digest('VO-RM-v1-'||p_current_password,'sha256'),'hex')=lower(v_user.password);
  end if;
  if v_valid is not true then raise exception 'invalid_current_password'; end if;
  v_new_username:=trim(coalesce(nullif(p_username,''),v_user.username));
  if v_new_username !~ '^[A-Za-z0-9._-]{3,50}$' then raise exception 'invalid_username'; end if;
  if coalesce(p_new_password,'')<>'' and length(p_new_password)<8 then raise exception 'weak_password'; end if;
  if coalesce(p_recovery_email,'')<>'' and p_recovery_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then raise exception 'invalid_email'; end if;
  update public.users set username=v_new_username,
    password=case when coalesce(p_new_password,'')<>'' then extensions.crypt(p_new_password,extensions.gen_salt('bf',12)) else password end,
    recovery_email=nullif(lower(trim(coalesce(p_recovery_email,''))),'')
   where id=v_user.id;
  if coalesce(p_new_password,'')<>'' then
    update public.app_sessions set revoked_at=now() where user_id=v_user.id
      and token_hash<>encode(extensions.digest(p_token,'sha256'),'hex') and revoked_at is null;
  end if;
  return jsonb_build_object('ok',true,'username',v_new_username);
end $$;


create or replace function public.app_admin_reset_user_password(p_token text,p_user_id uuid,p_new_password text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $
declare v_actor public.users%rowtype; v_target public.users%rowtype;
begin
  select u.* into v_actor from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_actor.role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  select * into v_target from public.users where id=p_user_id and is_active=true;
  if not found or v_actor.id=v_target.id or v_target.role='super_admin' then raise exception 'access_denied'; end if;
  if v_actor.role='admin' and not (v_target.role='user' and v_target.shop_id=v_actor.shop_id) then
    raise exception 'access_denied';
  end if;
  if length(coalesce(p_new_password,''))<8 then raise exception 'weak_password'; end if;
  update public.users
     set password=extensions.crypt(p_new_password,extensions.gen_salt('bf',12))
   where id=v_target.id;
  update public.app_sessions set revoked_at=now() where user_id=v_target.id and revoked_at is null;
  insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
  values(coalesce(v_target.shop_id,v_actor.shop_id),v_actor.id,v_actor.username,'user.password_reset','users',v_target.id::text,
    'Password reset for '||v_target.username);
  return jsonb_build_object('ok',true,'user_id',v_target.id,'username',v_target.username);
end $;

create or replace function public.app_reset_password_by_recovery(p_username text,p_recovery_email text,p_new_password text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $
declare v_user public.users%rowtype; v_key text; v_attempt public.login_attempts%rowtype;
begin
  v_key:='reset:'||lower(trim(coalesce(p_username,'')));
  if length(trim(coalesce(p_username,'')))<1 or length(trim(coalesce(p_recovery_email,'')))<3 then
    raise exception 'invalid_recovery_details';
  end if;
  select * into v_attempt from public.login_attempts where username=v_key;
  if found and v_attempt.locked_until is not null and v_attempt.locked_until>now() then
    raise exception 'too_many_attempts';
  end if;
  select * into v_user from public.users
   where lower(username)=lower(trim(p_username)) and is_active=true;
  if not found then
    insert into public.login_attempts(username,failed_count,locked_until,last_attempt_at)
    values(v_key,1,null,now()) on conflict(username) do update
      set failed_count=public.login_attempts.failed_count+1,last_attempt_at=now(),
          locked_until=case when public.login_attempts.failed_count+1>=5 then now()+interval '15 minutes' else public.login_attempts.locked_until end;
    raise exception 'invalid_recovery_details';
  end if;
  if nullif(trim(coalesce(v_user.recovery_email,'')),'') is null then raise exception 'recovery_not_configured'; end if;
  if lower(trim(v_user.recovery_email))<>lower(trim(p_recovery_email)) then
    insert into public.login_attempts(username,failed_count,locked_until,last_attempt_at)
    values(v_key,1,null,now()) on conflict(username) do update
      set failed_count=public.login_attempts.failed_count+1,last_attempt_at=now(),
          locked_until=case when public.login_attempts.failed_count+1>=5 then now()+interval '15 minutes' else public.login_attempts.locked_until end;
    raise exception 'invalid_recovery_details';
  end if;
  if length(coalesce(p_new_password,''))<8 then raise exception 'weak_password'; end if;
  update public.users
     set password=extensions.crypt(p_new_password,extensions.gen_salt('bf',12))
   where id=v_user.id;
  update public.app_sessions set revoked_at=now() where user_id=v_user.id and revoked_at is null;
  delete from public.login_attempts where username=v_key;
  insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
  values(v_user.shop_id,v_user.id,v_user.username,'user.self_password_reset','users',v_user.id::text,'Self-service password reset');
  return jsonb_build_object('ok',true);
end $;

revoke all on function public.app_get_users(text) from public;
revoke all on function public.app_create_user(text,jsonb) from public;
revoke all on function public.app_delete_user(text,uuid) from public;
revoke all on function public.app_admin_reset_user_password(text,uuid,text) from public;
revoke all on function public.app_reset_password_by_recovery(text,text,text) from public;
revoke all on function public.app_update_own_profile(text,text,text,text,text) from public;
grant execute on function public.app_get_users(text) to anon,authenticated;
grant execute on function public.app_create_user(text,jsonb) to anon,authenticated;
grant execute on function public.app_delete_user(text,uuid) to anon,authenticated;
grant execute on function public.app_admin_reset_user_password(text,uuid,text) to anon,authenticated;
grant execute on function public.app_reset_password_by_recovery(text,text,text) to anon,authenticated;
grant execute on function public.app_update_own_profile(text,text,text,text,text) to anon,authenticated;


-- Tenant settings and append-only audit log.
create or replace function public.app_get_settings(p_token text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shop uuid;
begin
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then return '{}'::jsonb; end if;
  return coalesce((select jsonb_build_object('company_name',company_name,'software_name',software_name,
    'phone',phone,'email',email,'address',address,'logo_data_url',logo_data_url,
    'recovery_email',recovery_email,'extra',extra) from public.settings where shop_id=v_shop),'{}'::jsonb);
end $$;

create or replace function public.app_save_settings(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_row public.settings%rowtype; v_extra jsonb;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.shop_id is null or v_user.role<>'admin' then raise exception 'access_denied'; end if;
  v_extra:=jsonb_build_object('executives',
    case when jsonb_typeof(p_payload->'executives')='array' then p_payload->'executives' else '[]'::jsonb end);
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
  return to_jsonb(v_row);
end $$;

create or replace function public.app_add_audit(p_token text,p_action text,p_entity_type text,p_entity_id text,p_details text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found then raise exception 'invalid_session'; end if;
  insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
  values(v_user.shop_id,v_user.id,v_user.username,left(coalesce(p_action,''),100),
    left(coalesce(p_entity_type,''),100),left(coalesce(p_entity_id,''),100),left(coalesce(p_details,''),2000));
end $$;

create or replace function public.app_get_audit(p_token text,p_limit int default 100)
returns setof public.audit_log language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  return query select * from public.audit_log a where
    (v_user.role='super_admin' or a.shop_id=v_user.shop_id)
    order by a.created_at desc limit greatest(1,least(coalesce(p_limit,100),500));
end $$;

revoke all on function public.app_get_settings(text) from public;
revoke all on function public.app_save_settings(text,jsonb) from public;
revoke all on function public.app_add_audit(text,text,text,text,text) from public;
revoke all on function public.app_get_audit(text,int) from public;
grant execute on function public.app_get_settings(text) to anon,authenticated;
grant execute on function public.app_save_settings(text,jsonb) to anon,authenticated;
grant execute on function public.app_add_audit(text,text,text,text,text) to anon,authenticated;
grant execute on function public.app_get_audit(text,int) to anon,authenticated;

drop policy if exists "public_all_settings" on public.settings;
drop policy if exists "public_all_audit_log" on public.audit_log;
revoke all on public.settings from anon,authenticated;
revoke all on public.audit_log from anon,authenticated;


-- Super Admin company, subscription and dashboard operations.
create or replace function public.app_superadmin(p_token text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor public.users%rowtype; v_shop public.shops%rowtype; v_id uuid; v_sub public.subscriptions%rowtype;
  v_code text; v_password text;
begin
  select u.* into v_actor from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_actor.role<>'super_admin' then raise exception 'access_denied'; end if;

  if p_action='shops' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'code',s.code,
      'contact_number',s.contact_number,'email',s.email,'address',s.address,'logo_url',s.logo_url,
      'is_active',s.is_active,'license_expiry',s.license_expiry,'plan_name',s.plan_name,
      'max_users',s.max_users,'created_at',s.created_at) order by s.name) from public.shops s),'[]'::jsonb);

  elsif p_action='create_shop' then
    v_code:=upper(regexp_replace(coalesce(p_payload->>'code',''),'\s+','','g'));
    v_password:=coalesce(p_payload->>'adminPassword','');
    if length(trim(coalesce(p_payload->>'name','')))<2 then raise exception 'name_required'; end if;
    if v_code !~ '^[A-Z0-9_-]{2,20}$' then raise exception 'invalid_code'; end if;
    if length(v_password)<8 then raise exception 'weak_admin_password'; end if;
    insert into public.shops(name,code,contact_number,email,address,plan_name,license_expiry,max_users,is_active)
    values(left(trim(p_payload->>'name'),150),v_code,left(coalesce(p_payload->>'contact',''),30),
      left(coalesce(p_payload->>'email',''),254),left(coalesce(p_payload->>'address',''),1000),
      left(coalesce(p_payload->>'plan','Basic'),50),nullif(p_payload->>'licenseExpiry','')::date,
      greatest(1,least(coalesce((p_payload->>'maxUsers')::int,5),1000)),true) returning * into v_shop;
    if coalesce(p_payload->>'adminUsername','') !~ '^[A-Za-z0-9._-]{3,50}$' then raise exception 'invalid_admin_username'; end if;
    insert into public.users(username,password,role,shop_id,display_name,is_active)
    values(trim(p_payload->>'adminUsername'),extensions.crypt(v_password,extensions.gen_salt('bf',12)),'admin',v_shop.id,
      left(coalesce(nullif(trim(p_payload->>'adminName'),''),trim(p_payload->>'adminUsername')),150),true);
    insert into public.settings(shop_id,company_name,software_name,phone,email,address)
    values(v_shop.id,v_shop.name,'Recountix',v_shop.contact_number,v_shop.email,v_shop.address)
    on conflict(shop_id) do nothing;
    if v_shop.license_expiry is not null then
      insert into public.subscriptions(shop_id,plan_name,amount,start_date,end_date,status)
      values(v_shop.id,v_shop.plan_name,greatest(coalesce((p_payload->>'amount')::numeric,0),0),
        current_date,v_shop.license_expiry,'active');
    end if;
    insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
    values(v_shop.id,v_actor.id,v_actor.username,'shop.create','shop',v_shop.id::text,'Created shop '||v_shop.name);
    return to_jsonb(v_shop)-'razorpay_key_secret'-'whatsapp_api_key'-'sms_api_key';

  elsif p_action='update_shop' then
    v_id:=(p_payload->>'id')::uuid;
    update public.shops set name=left(trim(p_payload->>'name'),150),
      contact_number=left(coalesce(p_payload->>'contact',''),30),email=left(coalesce(p_payload->>'email',''),254),
      address=left(coalesce(p_payload->>'address',''),1000),plan_name=left(coalesce(p_payload->>'plan','Basic'),50),
      license_expiry=nullif(p_payload->>'licenseExpiry','')::date,
      max_users=greatest(1,least(coalesce((p_payload->>'maxUsers')::int,5),1000))
      where id=v_id returning * into v_shop;
    if not found then raise exception 'shop_not_found'; end if;
    insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
      values(v_id,v_actor.id,v_actor.username,'shop.update','shop',v_id::text,'Updated shop');
    return to_jsonb(v_shop)-'razorpay_key_secret'-'whatsapp_api_key'-'sms_api_key';

  elsif p_action='toggle_shop' then
    v_id:=(p_payload->>'id')::uuid;
    update public.shops set is_active=coalesce((p_payload->>'is_active')::boolean,false)
      where id=v_id returning * into v_shop;
    if not found then raise exception 'shop_not_found'; end if;
    update public.app_sessions set revoked_at=now() where user_id in
      (select id from public.users where shop_id=v_id) and v_shop.is_active=false and revoked_at is null;
    insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
      values(v_id,v_actor.id,v_actor.username,case when v_shop.is_active then 'shop.activate' else 'shop.deactivate' end,
        'shop',v_id::text,'Shop status changed');
    return to_jsonb(v_shop)-'razorpay_key_secret'-'whatsapp_api_key'-'sms_api_key';

  elsif p_action='delete_shop' then
    v_id:=(p_payload->>'id')::uuid;
    if not exists(select 1 from public.shops where id=v_id) then raise exception 'shop_not_found'; end if;
    insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
      values(v_id,v_actor.id,v_actor.username,'shop.delete','shop',v_id::text,'Shop permanently deleted');
    delete from public.shops where id=v_id;
    return jsonb_build_object('ok',true);

  elsif p_action='subscriptions' then
    return coalesce((select jsonb_agg(jsonb_build_object('shop',to_jsonb(s)-'razorpay_key_secret'-'whatsapp_api_key'-'sms_api_key',
      'subscription',case when sub.id is null then null else to_jsonb(sub) end,'endDate',
      greatest(s.license_expiry,sub.end_date)) order by s.name)
      from public.shops s left join lateral(select x.* from public.subscriptions x where x.shop_id=s.id
        order by x.end_date desc limit 1) sub on true),'[]'::jsonb);

  elsif p_action='renew' then
    v_id:=(p_payload->>'shop_id')::uuid;
    if not exists(select 1 from public.shops where id=v_id) then raise exception 'shop_not_found'; end if;
    if nullif(p_payload->>'endDate','')::date<current_date then raise exception 'invalid_end_date'; end if;
    insert into public.subscriptions(shop_id,plan_name,amount,start_date,end_date,status,remarks)
    values(v_id,left(coalesce(p_payload->>'plan','Basic'),50),greatest(coalesce((p_payload->>'amount')::numeric,0),0),
      current_date,(p_payload->>'endDate')::date,'active',left(coalesce(p_payload->>'remarks',''),1000))
      returning * into v_sub;
    update public.shops set license_expiry=v_sub.end_date,plan_name=v_sub.plan_name,is_active=true where id=v_id;
    insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
      values(v_id,v_actor.id,v_actor.username,'subscription.renew','subscription',v_sub.id::text,'Subscription renewed');
    return to_jsonb(v_sub);

  elsif p_action='stats' then
    return jsonb_build_object('totalShops',(select count(*) from public.shops),
      'activeShops',(select count(*) from public.shops where is_active),
      'inactiveShops',(select count(*) from public.shops where not is_active),
      'totalCustomers',(select count(*) from public.customers),
      'totalOutstanding',(select coalesce(sum(outstanding),0) from public.customers),
      'expiringSoon',(select count(*) from public.shops where license_expiry between current_date and current_date+interval '30 days'),
      'expired',(select count(*) from public.shops where license_expiry<current_date),
      'shops',coalesce((select jsonb_agg(to_jsonb(s)-'razorpay_key_secret'-'whatsapp_api_key'-'sms_api_key') from public.shops s),'[]'::jsonb));
  end if;
  raise exception 'invalid_action';
end $$;

revoke all on function public.app_superadmin(text,text,jsonb) from public;
grant execute on function public.app_superadmin(text,text,jsonb) to anon,authenticated;

drop policy if exists "public_all_shops" on public.shops;
drop policy if exists "public_all_subscriptions" on public.subscriptions;
revoke all on public.shops from anon,authenticated;
revoke all on public.subscriptions from anon,authenticated;


create or replace function public.app_get_shops(p_token text)
returns table(id uuid,name text,code text,contact_number text,email text,address text,logo_url text,
  is_active boolean,license_expiry date,plan_name text,max_users integer,created_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found then raise exception 'invalid_session'; end if;
  return query select s.id,s.name,s.code,s.contact_number,s.email,s.address,s.logo_url,s.is_active,
    s.license_expiry,s.plan_name,s.max_users,s.created_at from public.shops s
    where (v_user.role='super_admin' or s.id=v_user.shop_id) order by s.name;
end $$;
revoke all on function public.app_get_shops(text) from public;
grant execute on function public.app_get_shops(text) to anon,authenticated;


-- PTP and escalation workflows, scoped to the verified session shop.
create or replace function public.app_collection(p_token text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_id uuid; v_ptp public.promises_to_pay%rowtype;
  v_esc public.escalations%rowtype; v_status text;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.shop_id is null then raise exception 'invalid_session'; end if;

  if p_action='ptp_list' then
    v_status:=coalesce(p_payload->>'status','all');
    return coalesce((select jsonb_agg(to_jsonb(p) order by p.promised_date)
      from public.promises_to_pay p where p.shop_id=v_user.shop_id
       and (v_status='all' or p.status=v_status)),'[]'::jsonb);

  elsif p_action='ptp_save' then
    if not exists(select 1 from public.customers where id=(p_payload->>'customer_id')::uuid
      and shop_id=v_user.shop_id) then raise exception 'customer_not_found'; end if;
    if coalesce((p_payload->>'promised_amount')::numeric,0)<0 then raise exception 'invalid_amount'; end if;
    v_id=nullif(p_payload->>'id','')::uuid;
    if v_id is null then
      insert into public.promises_to_pay(shop_id,customer_id,agent_id,promised_amount,promised_date,notes,status,created_by)
      values(v_user.shop_id,(p_payload->>'customer_id')::uuid,nullif(p_payload->>'agent_id','')::uuid,
        (p_payload->>'promised_amount')::numeric,(p_payload->>'promised_date')::date,
        left(coalesce(p_payload->>'notes',''),2000),'open',v_user.id) returning * into v_ptp;
    else
      update public.promises_to_pay set agent_id=nullif(p_payload->>'agent_id','')::uuid,
        promised_amount=(p_payload->>'promised_amount')::numeric,promised_date=(p_payload->>'promised_date')::date,
        notes=left(coalesce(p_payload->>'notes',''),2000),updated_at=now()
       where id=v_id and shop_id=v_user.shop_id returning * into v_ptp;
      if not found then raise exception 'ptp_not_found'; end if;
    end if;
    update public.customers set ptp_date=v_ptp.promised_date,ptp_amount=v_ptp.promised_amount,
      ptp_notes=v_ptp.notes,updated_at=now() where id=v_ptp.customer_id and shop_id=v_user.shop_id;
    return to_jsonb(v_ptp);

  elsif p_action='ptp_status' then
    v_id=(p_payload->>'id')::uuid;v_status=p_payload->>'status';
    if v_status not in ('open','kept','broken','cancelled') then raise exception 'invalid_status'; end if;
    update public.promises_to_pay set status=v_status,updated_at=now(),
      broken_at=case when v_status='broken' then now() else broken_at end,
      kept_at=case when v_status='kept' then now() else kept_at end,
      kept_recovery_id=case when v_status='kept' then nullif(p_payload->>'kept_recovery_id','')::uuid else kept_recovery_id end
      where id=v_id and shop_id=v_user.shop_id returning * into v_ptp;
    if not found then raise exception 'ptp_not_found'; end if;
    if v_status in ('kept','broken','cancelled') then
      update public.customers set ptp_date=null,ptp_amount=null,ptp_notes=null,updated_at=now()
       where id=v_ptp.customer_id and shop_id=v_user.shop_id;
    end if;
    if v_status='broken' and not exists(select 1 from public.escalations where
      shop_id=v_user.shop_id and customer_id=v_ptp.customer_id and reason='ptp_broken' and status='open') then
      insert into public.escalations(shop_id,customer_id,reason,level,notes,status)
      values(v_user.shop_id,v_ptp.customer_id,'ptp_broken',1,
        'PTP broken. Amount: '||v_ptp.promised_amount||' Date: '||v_ptp.promised_date,'open');
    end if;
    return to_jsonb(v_ptp);

  elsif p_action='ptp_delete' then
    if v_user.role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
    delete from public.promises_to_pay where id=(p_payload->>'id')::uuid and shop_id=v_user.shop_id;
    return jsonb_build_object('ok',true);

  elsif p_action='escalation_list' then
    v_status:=coalesce(p_payload->>'status','all');
    return coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from public.escalations e where e.shop_id=v_user.shop_id
       and (v_status='all' or e.status=v_status)),'[]'::jsonb);

  elsif p_action='escalation_update' then
    v_id=(p_payload->>'id')::uuid;v_status=coalesce(p_payload->>'status','open');
    if v_status not in ('open','in_progress','resolved','closed') then raise exception 'invalid_status'; end if;
    update public.escalations set status=v_status,level=greatest(1,least(coalesce((p_payload->>'level')::int,level),10)),
      notes=left(coalesce(p_payload->>'notes',notes),2000),updated_at=now()
      where id=v_id and shop_id=v_user.shop_id returning * into v_esc;
    if not found then raise exception 'escalation_not_found'; end if;
    return to_jsonb(v_esc);
  end if;
  raise exception 'invalid_action';
end $$;
revoke all on function public.app_collection(text,text,jsonb) from public;
grant execute on function public.app_collection(text,text,jsonb) to anon,authenticated;


-- Activity, assignment, legal, payment and receipt operations.
create or replace function public.app_records(p_token text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_customer public.customers%rowtype; v_agent public.users%rowtype;
  v_activity public.agent_activity_log%rowtype; v_notice public.legal_notices%rowtype;
  v_link public.payment_links%rowtype; v_receipt public.receipts%rowtype; v_limit int; v_no text;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.shop_id is null then raise exception 'invalid_session'; end if;

  if p_action='assign_agent' then
    if v_user.role<>'admin' then raise exception 'access_denied'; end if;
    select * into v_customer from public.customers where id=(p_payload->>'customer_id')::uuid
      and shop_id=v_user.shop_id;
    if not found then raise exception 'customer_not_found'; end if;
    if nullif(p_payload->>'agent_id','') is not null then
      select * into v_agent from public.users where id=(p_payload->>'agent_id')::uuid
        and shop_id=v_user.shop_id and is_active=true;
      if not found then raise exception 'invalid_agent'; end if;
    end if;
    update public.customers set assigned_agent_id=nullif(p_payload->>'agent_id','')::uuid,
      executive=left(coalesce(p_payload->>'executive',''),150),updated_at=now()
      where id=v_customer.id returning * into v_customer;
    return to_jsonb(v_customer);

  elsif p_action='activity_add' then
    if not exists(select 1 from public.customers where id=(p_payload->>'customer_id')::uuid
      and shop_id=v_user.shop_id) then raise exception 'customer_not_found'; end if;
    insert into public.agent_activity_log(shop_id,agent_id,customer_id,task_id,activity_type,outcome,notes,
      gps_lat,gps_lng,duration_sec)
    values(v_user.shop_id,coalesce(nullif(p_payload->>'agent_id','')::uuid,v_user.id),
      (p_payload->>'customer_id')::uuid,nullif(p_payload->>'task_id','')::uuid,
      coalesce(p_payload->>'activity_type','note'),left(coalesce(p_payload->>'outcome',''),500),
      left(coalesce(p_payload->>'notes',''),2000),nullif(p_payload->>'gps_lat','')::numeric,
      nullif(p_payload->>'gps_lng','')::numeric,nullif(p_payload->>'duration_sec','')::int)
      returning * into v_activity;
    return to_jsonb(v_activity);

  elsif p_action='activity_list' then
    v_limit:=greatest(1,least(coalesce((p_payload->>'limit')::int,100),500));
    return coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from (select * from public.agent_activity_log where shop_id=v_user.shop_id
        and (nullif(p_payload->>'agent_id','') is null or agent_id=(p_payload->>'agent_id')::uuid)
        order by created_at desc limit v_limit) a),'[]'::jsonb);

  elsif p_action='legal_add' then
    if not exists(select 1 from public.customers where id=(p_payload->>'customer_id')::uuid
      and shop_id=v_user.shop_id) then raise exception 'customer_not_found'; end if;
    insert into public.legal_notices(shop_id,customer_id,notice_type,amount_at_issue,sent_via,sent_at,created_by,notes)
    values(v_user.shop_id,(p_payload->>'customer_id')::uuid,coalesce(p_payload->>'notice_type','reminder_letter'),
      greatest(coalesce((p_payload->>'amount_at_issue')::numeric,0),0),left(coalesce(p_payload->>'sent_via','print'),30),
      coalesce(nullif(p_payload->>'sent_at','')::timestamptz,now()),v_user.id,left(coalesce(p_payload->>'notes',''),2000))
      returning * into v_notice;
    update public.customers set last_legal_notice_at=now(),updated_at=now()
      where id=v_notice.customer_id and shop_id=v_user.shop_id;
    return to_jsonb(v_notice);

  elsif p_action='payment_link_add' then
    if not exists(select 1 from public.customers where id=(p_payload->>'customer_id')::uuid
      and shop_id=v_user.shop_id) then raise exception 'customer_not_found'; end if;
    if coalesce((p_payload->>'amount')::numeric,0)<=0 then raise exception 'invalid_amount'; end if;
    insert into public.payment_links(shop_id,customer_id,amount,currency,gateway,short_url,qr_data,status,notes,created_by)
    values(v_user.shop_id,(p_payload->>'customer_id')::uuid,(p_payload->>'amount')::numeric,'INR',
      left(coalesce(p_payload->>'gateway','upi'),30),nullif(p_payload->>'short_url',''),
      nullif(p_payload->>'qr_data',''),'created',left(coalesce(p_payload->>'notes',''),1000),v_user.id)
      returning * into v_link;
    return to_jsonb(v_link);

  elsif p_action='receipt_add' then
    if not exists(select 1 from public.recoveries where id=(p_payload->>'recovery_id')::uuid
      and shop_id=v_user.shop_id) then raise exception 'recovery_not_found'; end if;
    v_no:=nullif(trim(p_payload->>'receipt_no'),'');
    if v_no is null then v_no:=public.next_receipt_no(v_user.shop_id); end if;
    insert into public.receipts(shop_id,recovery_id,customer_id,receipt_no,amount,pdf_url,whatsapp_sent)
    values(v_user.shop_id,(p_payload->>'recovery_id')::uuid,nullif(p_payload->>'customer_id','')::uuid,
      left(v_no,100),greatest(coalesce((p_payload->>'amount')::numeric,0),0),nullif(p_payload->>'pdf_url',''),
      coalesce((p_payload->>'whatsapp_sent')::boolean,false)) returning * into v_receipt;
    return to_jsonb(v_receipt);

  elsif p_action='set_field_agent' then
    if v_user.role<>'admin' then raise exception 'access_denied'; end if;
    update public.users set is_field_agent=coalesce((p_payload->>'is_field')::boolean,false)
      where id=(p_payload->>'user_id')::uuid and shop_id=v_user.shop_id and role<>'super_admin'
      returning * into v_agent;
    if not found then raise exception 'user_not_found'; end if;
    return jsonb_build_object('id',v_agent.id,'is_field_agent',v_agent.is_field_agent);
  end if;
  raise exception 'invalid_action';
end $$;

create or replace function public.app_bulk_customers(p_token text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item jsonb; v_result jsonb:='[]'::jsonb; v_count int;
begin
  if jsonb_typeof(p_rows)<>'array' then raise exception 'invalid_rows'; end if;
  v_count:=jsonb_array_length(p_rows);
  if v_count<1 or v_count>500 then raise exception 'batch_size_1_to_500'; end if;
  for v_item in select value from jsonb_array_elements(p_rows)
  loop v_result:=v_result||jsonb_build_array(public.app_save_customer(p_token,null,v_item)); end loop;
  return v_result;
end $$;

revoke all on function public.app_records(text,text,jsonb) from public;
revoke all on function public.app_bulk_customers(text,jsonb) from public;
grant execute on function public.app_records(text,text,jsonb) to anon,authenticated;
grant execute on function public.app_bulk_customers(text,jsonb) to anon,authenticated;


create or replace function public.app_mark_reminder(p_token text,p_customer_id uuid,p_next_date date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_shop uuid;
begin
 select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() and u.is_active;
 if not found then raise exception 'invalid_session'; end if;
 update public.customers set last_reminder_at=now(),next_reminder_date=p_next_date,updated_at=now()
  where id=p_customer_id and shop_id=v_shop;
end $$;

create or replace function public.app_set_agent_credentials(p_token text,p_user_id uuid,p_code text,p_pin text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype;
begin
 select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() and u.is_active;
 if not found or v_user.role<>'admin' then raise exception 'access_denied'; end if;
 if coalesce(p_code,'') !~ '^[A-Za-z0-9_-]{3,30}$' or length(coalesce(p_pin,''))<6 then raise exception 'invalid_credentials'; end if;
 update public.users set agent_code=upper(trim(p_code)),field_pin=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),is_field_agent=true
  where id=p_user_id and shop_id=v_user.shop_id and role='user';
 if not found then raise exception 'user_not_found'; end if;
end $$;
revoke all on function public.app_mark_reminder(text,uuid,date) from public;
revoke all on function public.app_set_agent_credentials(text,uuid,text,text) from public;
grant execute on function public.app_mark_reminder(text,uuid,date) to anon,authenticated;
grant execute on function public.app_set_agent_credentials(text,uuid,text,text) to anon,authenticated;


create or replace function public.app_aging(p_token text,p_action text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_result jsonb; v_count int:=0; r record;
begin
 select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() and u.is_active;
 if not found or v_user.shop_id is null then raise exception 'invalid_session'; end if;
 if p_action='summary' then
   select to_jsonb(x) into v_result from public.shop_aging_summary(v_user.shop_id) x;
   return coalesce(v_result,'{}'::jsonb);
 elsif p_action='recalc' then
   perform public.recalc_all_aging(v_user.shop_id);return jsonb_build_object('ok',true);
 elsif p_action='broken_ptp' then
   if v_user.role<>'admin' then raise exception 'access_denied'; end if;
   for r in select * from public.promises_to_pay where shop_id=v_user.shop_id and status='open'
     and promised_date<current_date-1 for update
   loop
     update public.promises_to_pay set status='broken',broken_at=now(),updated_at=now() where id=r.id;
     if not exists(select 1 from public.escalations where shop_id=v_user.shop_id and customer_id=r.customer_id
       and reason='ptp_broken' and status='open') then
       insert into public.escalations(shop_id,customer_id,reason,level,notes,status)
       values(v_user.shop_id,r.customer_id,'ptp_broken',1,'Overdue PTP processed automatically','open');
     end if;
     v_count:=v_count+1;
   end loop;
   return to_jsonb(v_count);
 end if;
 raise exception 'invalid_action';
end $$;
revoke all on function public.app_aging(text,text) from public;
grant execute on function public.app_aging(text,text) to anon,authenticated;
revoke all on function public.process_broken_ptp(integer) from anon,authenticated;
revoke all on function public.recalc_all_aging(uuid) from anon,authenticated;
revoke all on function public.shop_aging_summary(uuid) from anon,authenticated;
revoke all on function public.next_receipt_no(uuid) from anon,authenticated;


-- Customer self-view portal: secure read-only summary by business code + mobile + portal PIN.
alter table public.customers add column if not exists portal_pin_hash text;

create or replace function public.app_set_customer_portal_pin(p_token text,p_customer_id uuid,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $
declare v_user public.users%rowtype; v_customer public.customers%rowtype;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  select * into v_customer from public.customers where id=p_customer_id for update;
  if not found then raise exception 'customer_not_found'; end if;
  if v_user.role='admin' and v_customer.shop_id<>v_user.shop_id then raise exception 'access_denied'; end if;
  if length(coalesce(p_pin,''))<4 then raise exception 'weak_pin'; end if;
  update public.customers set portal_pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)), updated_at=now()
   where id=v_customer.id;
  insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
  values(v_customer.shop_id,v_user.id,v_user.username,'customer.portal_pin_set','customers',v_customer.id::text,'Customer portal PIN set/reset');
  return jsonb_build_object('ok',true,'customer_id',v_customer.id);
end $;

create or replace function public.app_customer_self_view(p_shop_code text,p_mobile text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $
declare v_shop public.shops%rowtype; v_customer public.customers%rowtype; v_paid numeric:=0; v_last public.recoveries%rowtype; v_recent jsonb:='[]'::jsonb; v_mobile text;
begin
  v_mobile:=regexp_replace(coalesce(p_mobile,''),'[^0-9]','','g');
  if length(trim(coalesce(p_shop_code,'')))<1 or length(v_mobile)<10 or length(coalesce(p_pin,''))<4 then return jsonb_build_object('error','invalid_input'); end if;
  select * into v_shop from public.shops where lower(code)=lower(trim(p_shop_code)) and coalesce(is_active,true)=true limit 1;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into v_customer from public.customers c
   where c.shop_id=v_shop.id and c.portal_pin_hash is not null
     and (right(regexp_replace(coalesce(c.mobile,''),'[^0-9]','','g'),10)=right(v_mobile,10)
       or right(regexp_replace(coalesce(c.alt_mobile,''),'[^0-9]','','g'),10)=right(v_mobile,10))
   order by c.created_at desc limit 1;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if extensions.crypt(p_pin,v_customer.portal_pin_hash)<>v_customer.portal_pin_hash then return jsonb_build_object('error','not_found'); end if;
  select coalesce(sum(r.amount),0) into v_paid from public.recoveries r where r.shop_id=v_shop.id and r.customer_id=v_customer.id;
  select * into v_last from public.recoveries r where r.shop_id=v_shop.id and r.customer_id=v_customer.id order by r.recovery_date desc,r.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('amount',x.amount,'date',x.recovery_date,'mode',x.payment_mode,'receipt_no',x.receipt_no) order by x.recovery_date desc,x.created_at desc),'[]'::jsonb)
   into v_recent
   from (select amount,recovery_date,payment_mode,receipt_no,created_at from public.recoveries where shop_id=v_shop.id and customer_id=v_customer.id order by recovery_date desc,created_at desc limit 5) x;
  return jsonb_build_object('business_name',v_shop.name,'customer_name',v_customer.name,'bill_amount',coalesce(v_customer.bill,0),'paid_amount',coalesce(v_paid,0)+coalesce(v_customer.down_payment,0),'pending_amount',coalesce(v_customer.outstanding,0),'last_payment_date',v_last.recovery_date,'status',coalesce(v_customer.status,'Active'),'recent_payments',v_recent);
end $;

revoke all on function public.app_set_customer_portal_pin(text,uuid,text) from public;
revoke all on function public.app_customer_self_view(text,text,text) from public;
grant execute on function public.app_set_customer_portal_pin(text,uuid,text) to anon,authenticated;
grant execute on function public.app_customer_self_view(text,text,text) to anon,authenticated;

-- FINAL LOCKDOWN: no business table is directly accessible through the anon client.
-- All browser operations above use narrow SECURITY DEFINER RPCs with verified opaque sessions.
do $$
declare t text; p record;
begin
  foreach t in array array[
    'shops','users','customers','recoveries','settings','subscriptions','audit_log',
    'customer_balances','promises_to_pay','agent_tasks','agent_activity_log','reminder_queue',
    'payment_links','legal_notices','escalations','receipts','erp_sync_log','reminder_rules',
    'customer_invoices','ads','system_config','app_sessions','field_sessions','login_attempts'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security',t);
      for p in select policyname from pg_policies where schemaname='public' and tablename=t
      loop execute format('drop policy if exists %I on public.%I',p.policyname,t); end loop;
      execute format('revoke all on table public.%I from anon, authenticated',t);
    end if;
  end loop;
end $$;

-- Remove execute privilege from obsolete/custom functions by default when they exist.
-- Approved app_* RPCs are granted explicitly in this migration.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('increment_ad_click','process_broken_ptp','recalc_all_aging',
                        'shop_aging_summary','next_receipt_no')
  loop
    execute format('revoke all on function %s from anon, authenticated',f.signature);
  end loop;
end $$;

select 'Recountix production security foundation applied' as status;
