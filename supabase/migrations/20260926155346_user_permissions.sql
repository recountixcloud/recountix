-- Per-user business permissions. Apply after the existing security and backup migrations.
-- No customer data is changed. Existing users retain their current ordinary access.
create table if not exists public.user_permissions (
 user_id uuid primary key references public.users(id) on delete cascade,
 permissions jsonb not null check (jsonb_typeof(permissions) = 'object'),
 updated_at timestamptz not null default now()
);
alter table public.user_permissions enable row level security;
revoke all on table public.user_permissions from public, anon, authenticated;

-- Internal helpers are deliberately unavailable through the Data API.
create or replace function public.app_permissions_for_user(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_permissions jsonb;
begin
 select role into v_role from public.users where id=p_user_id and is_active=true;
 if not found then return '{}'::jsonb; end if;
 if v_role in ('admin','super_admin') then
   return '{"view":true,"add":true,"modify":true,"delete":true,"settings":true,"backup":true,"restore":true}'::jsonb;
 end if;
 if v_role is distinct from 'user' then return '{}'::jsonb; end if;
 select permissions into v_permissions from public.user_permissions where user_id=p_user_id;
 return coalesce(v_permissions,'{"view":true,"add":true,"modify":true,"delete":false,"settings":false,"backup":true,"restore":false}'::jsonb);
end $$;
revoke all on function public.app_permissions_for_user(uuid) from public,anon,authenticated;

create or replace function public.app_require_permission(p_token text,p_permission text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session jsonb; v_permissions jsonb;
begin
 v_session:=public.app_validate_session(p_token);
 if (v_session->>'valid')::boolean is distinct from true then raise exception 'invalid_session'; end if;
 if p_permission='manage_users' then
   if coalesce(v_session->'user'->>'role','') not in ('admin','super_admin') then raise exception 'permission_denied:manage_users'; end if;
   return;
 end if;
 if p_permission not in ('view','add','modify','delete','settings','backup','restore') or p_permission is null then
   raise exception 'invalid_permission';
 end if;
 v_permissions:=public.app_permissions_for_user((v_session->'user'->>'id')::uuid);
 if (v_permissions->>'view')::boolean is distinct from true or
    (v_permissions->>p_permission)::boolean is distinct from true then
   raise exception 'permission_denied:%',p_permission;
 end if;
end $$;
revoke all on function public.app_require_permission(text,text) from public,anon,authenticated;

create or replace function public.app_get_my_permissions(p_token text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session jsonb;
begin
 v_session:=public.app_validate_session(p_token);
 if (v_session->>'valid')::boolean is distinct from true then raise exception 'invalid_session'; end if;
 return jsonb_build_object('role',v_session->'user'->>'role','permissions',public.app_permissions_for_user((v_session->'user'->>'id')::uuid));
end $$;
revoke all on function public.app_get_my_permissions(text) from public,anon,authenticated;
grant execute on function public.app_get_my_permissions(text) to anon,authenticated;

create or replace function public.app_get_user_access(p_token text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session jsonb; v_actor public.users%rowtype;
begin
 perform public.app_require_permission(p_token,'manage_users');
 v_session:=public.app_validate_session(p_token);
 select * into v_actor from public.users where id=(v_session->'user'->>'id')::uuid;
 return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'username',u.username,'display_name',u.display_name,
 'role',u.role,'shop_id',u.shop_id,'is_active',u.is_active,
 'permissions',case when u.is_active then public.app_permissions_for_user(u.id)
 else coalesce((select permissions from public.user_permissions where user_id=u.id),
 '{"view":true,"add":true,"modify":true,"delete":false,"settings":false,"backup":true,"restore":false}'::jsonb) end) order by u.username)
 from public.users u where v_actor.role='super_admin' or u.shop_id=v_actor.shop_id),'[]'::jsonb);
end $$;
revoke all on function public.app_get_user_access(text) from public,anon,authenticated;
grant execute on function public.app_get_user_access(text) to anon,authenticated;

create or replace function public.app_update_user_access(p_token text,p_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session jsonb; v_actor public.users%rowtype; v_target public.users%rowtype;
 v_permissions jsonb; v_username text; v_active boolean; v_before jsonb;
begin
 perform public.app_require_permission(p_token,'manage_users');
 v_session:=public.app_validate_session(p_token);
 select * into v_actor from public.users where id=(v_session->'user'->>'id')::uuid;
 select * into v_target from public.users where id=p_user_id for update;
 if not found or v_target.id=v_actor.id or v_target.role is distinct from 'user' or
    (v_actor.role<>'super_admin' and (v_actor.shop_id is null or v_target.shop_id is distinct from v_actor.shop_id)) then
   raise exception 'access_denied';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or
 exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('username','display_name','is_active','permissions')) then
   raise exception 'invalid_user_payload';
 end if;
 v_permissions:=p_payload->'permissions';
 if v_permissions is null or jsonb_typeof(v_permissions)<>'object' then raise exception 'invalid_permissions'; end if;
 if (select count(*) from jsonb_object_keys(v_permissions))<>7 or
 exists(select 1 from jsonb_each(v_permissions) x where x.key not in ('view','add','modify','delete','settings','backup','restore') or jsonb_typeof(x.value)<>'boolean') then
   raise exception 'invalid_permissions';
 end if;
 if v_permissions->>'view'='false' and exists(select 1 from jsonb_each(v_permissions) x where x.key<>'view' and x.value='true'::jsonb) then
   raise exception 'view_required_for_other_permissions';
 end if;
 v_username:=trim(coalesce(p_payload->>'username',v_target.username));
 if v_username !~ '^[A-Za-z0-9._-]{3,50}$' then raise exception 'invalid_username'; end if;
 if p_payload ? 'is_active' and jsonb_typeof(p_payload->'is_active')<>'boolean' then raise exception 'invalid_active_status'; end if;
 v_active:=coalesce((p_payload->>'is_active')::boolean,v_target.is_active,false);
 v_before:=public.app_permissions_for_user(v_target.id);
 update public.users set username=v_username,display_name=left(coalesce(nullif(trim(p_payload->>'display_name'),''),v_username),150),is_active=v_active where id=v_target.id;
 insert into public.user_permissions(user_id,permissions) values(v_target.id,v_permissions)
 on conflict(user_id) do update set permissions=excluded.permissions,updated_at=now();
 if not v_active then
   update public.app_sessions set revoked_at=now() where user_id=v_target.id and revoked_at is null;
   delete from public.field_sessions where agent_id=v_target.id;
 end if;
 insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
 values(v_target.shop_id,v_actor.id,v_actor.username,'user_access_updated','user',v_target.id::text,
 jsonb_build_object('before',v_before,'after',v_permissions,'is_active',v_active)::text);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.app_update_user_access(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.app_update_user_access(text,uuid,jsonb) to anon,authenticated;

CREATE OR REPLACE FUNCTION public.app_get_customers(p_token text)
 RETURNS SETOF customers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_shop uuid;
begin
  perform public.app_require_permission(p_token,'view');
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then return; end if;
  return query select * from public.customers where shop_id=v_shop order by created_at desc;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_get_recoveries(p_token text)
 RETURNS SETOF recoveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_shop uuid;
begin
  perform public.app_require_permission(p_token,'view');
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then return; end if;
  return query select * from public.recoveries where shop_id=v_shop order by recovery_date desc,created_at desc;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_save_recovery(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_shop uuid;
  v_customer public.customers%rowtype;
  v_row public.recoveries%rowtype;
  v_amount numeric;
  v_request_key text;
  v_receipt_no text;
begin
  perform public.app_require_permission(p_token,'add');
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
end $function$
;

CREATE OR REPLACE FUNCTION public.app_delete_customer(p_token text, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_shop uuid; v_role text;
begin
  perform public.app_require_permission(p_token,'delete');
  select u.shop_id,u.role into v_shop,v_role from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then raise exception 'access_denied'; end if;
  delete from public.customers where id=p_customer_id and shop_id=v_shop;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_delete_recovery(p_token text, p_recovery_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_shop uuid; v_role text; v_row public.recoveries%rowtype;
begin
  perform public.app_require_permission(p_token,'delete');
  select u.shop_id,u.role into v_shop,v_role from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then raise exception 'access_denied'; end if;
  select * into v_row from public.recoveries where id=p_recovery_id and shop_id=v_shop for update;
  if not found then raise exception 'recovery_not_found'; end if;
  update public.customers set outstanding=outstanding+v_row.amount,updated_at=now()
   where id=v_row.customer_id and shop_id=v_shop;
  delete from public.recoveries where id=v_row.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_bulk_customers(p_token text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_item jsonb; v_result jsonb:='[]'::jsonb; v_count int;
begin
  perform public.app_require_permission(p_token,'add');
  if jsonb_typeof(p_rows)<>'array' then raise exception 'invalid_rows'; end if;
  v_count:=jsonb_array_length(p_rows);
  if v_count<1 or v_count>500 then raise exception 'batch_size_1_to_500'; end if;
  for v_item in select value from jsonb_array_elements(p_rows)
  loop v_result:=v_result||jsonb_build_array(public.app_save_customer(p_token,null,v_item)); end loop;
  return v_result;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_mark_reminder(p_token text, p_customer_id uuid, p_next_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_shop uuid;
begin
  perform public.app_require_permission(p_token,'modify');
 select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() and u.is_active;
 if not found then raise exception 'invalid_session'; end if;
 update public.customers set last_reminder_at=now(),next_reminder_date=p_next_date,updated_at=now()
  where id=p_customer_id and shop_id=v_shop;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_backup_export(p_token text, p_shop_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user public.users%rowtype;
  v_shop uuid;
  v_shop_row public.shops%rowtype;
  v_table text;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
begin
  perform public.app_require_permission(p_token,'backup');
  select u.* into v_user
  from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now() and u.is_active=true;
  if not found then raise exception 'invalid_session'; end if;

  if v_user.role='super_admin' then raise exception 'access_denied'; end if;
  v_shop:=v_user.shop_id;
  if p_shop_id is not null and p_shop_id<>v_shop then raise exception 'access_denied'; end if;
  if v_shop is null then raise exception 'shop_required'; end if;
  select * into v_shop_row from public.shops where id=v_shop and is_active=true;
  if not found then raise exception 'invalid_shop'; end if;

  foreach v_table in array array['settings','customers','customer_invoices','promises_to_pay','recoveries','customer_balances','agent_tasks','agent_activity_log','reminder_queue','payment_links','legal_notices','escalations','receipts','erp_sync_log','reminder_rules']
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where t.shop_id=$1',v_table)
      into v_rows using v_shop;
    v_tables:=v_tables||jsonb_build_object(v_table,v_rows);
  end loop;

  return jsonb_build_object(
    'format','recountix-offline-backup',
    'version',1,
    'shop_id',v_shop,
    'shop_code',v_shop_row.code,
    'shop_name',v_shop_row.name,
    'exported_at',now(),
    'tables',v_tables
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_backup_restore(p_token text, p_backup jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user public.users%rowtype;
  v_shop uuid;
  v_table text;
  v_rows jsonb;
  v_row jsonb;
  v_counts jsonb:='{}'::jsonb;
  v_ref uuid;
begin
  perform public.app_require_permission(p_token,'restore');
  select u.* into v_user
  from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now() and u.is_active=true;
  if not found then raise exception 'invalid_session'; end if;
  -- Delegated permission checked above.
  if coalesce(p_backup->>'format','')<>'recountix-offline-backup'
     or coalesce((p_backup->>'version')::int,0)<>1 then
    raise exception 'invalid_backup_format';
  end if;
  v_shop:=(p_backup->>'shop_id')::uuid;
  if v_user.shop_id is null or v_user.shop_id<>v_shop then raise exception 'shop_mismatch'; end if;
  if not exists(select 1 from public.shops where id=v_shop and is_active=true) then raise exception 'invalid_shop'; end if;

  foreach v_table in array array['settings','customers','customer_invoices','promises_to_pay','recoveries','customer_balances','agent_tasks','agent_activity_log','reminder_queue','payment_links','legal_notices','escalations','receipts','erp_sync_log','reminder_rules']
  loop
    v_rows:=coalesce(p_backup->'tables'->v_table,'[]'::jsonb);
    if jsonb_typeof(v_rows)<>'array' then raise exception 'invalid_table_data:%',v_table; end if;
    for v_row in select value from jsonb_array_elements(v_rows)
    loop
      if coalesce(v_row->>'shop_id','')<>v_shop::text then raise exception 'shop_mismatch:%',v_table; end if;
    end loop;
  end loop;

  foreach v_table in array array['customer_invoices','promises_to_pay','recoveries','customer_balances','agent_tasks','agent_activity_log','reminder_queue','payment_links','legal_notices','escalations','receipts']
  loop
    for v_row in select value from jsonb_array_elements(coalesce(p_backup->'tables'->v_table,'[]'::jsonb))
    loop
      if nullif(v_row->>'customer_id','') is not null then
        v_ref:=(v_row->>'customer_id')::uuid;
        if not exists(select 1 from public.customers c where c.id=v_ref and c.shop_id=v_shop)
           and not (
             exists(select 1 from jsonb_array_elements(coalesce(p_backup->'tables'->'customers','[]'::jsonb)) b
                    where b->>'id'=v_ref::text and b->>'shop_id'=v_shop::text)
             and not exists(select 1 from public.customers c where c.id=v_ref and c.shop_id<>v_shop)
           ) then
          raise exception 'invalid_customer_reference:%',v_table;
        end if;
      end if;
    end loop;
  end loop;

  foreach v_table in array array['promises_to_pay','agent_tasks','agent_activity_log','payment_links']
  loop
    for v_row in select value from jsonb_array_elements(coalesce(p_backup->'tables'->v_table,'[]'::jsonb))
    loop
      foreach v_ref in array array[
        nullif(v_row->>'agent_id','')::uuid,
        nullif(v_row->>'assigned_by','')::uuid,
        nullif(v_row->>'created_by','')::uuid
      ]
      loop
        if v_ref is not null and not exists(select 1 from public.users u where u.id=v_ref and u.shop_id=v_shop) then
          raise exception 'invalid_user_reference:%',v_table;
        end if;
      end loop;
    end loop;
  end loop;

  foreach v_table in array array['payment_links','receipts']
  loop
    for v_row in select value from jsonb_array_elements(coalesce(p_backup->'tables'->v_table,'[]'::jsonb))
    loop
      if nullif(v_row->>'recovery_id','') is not null then
        v_ref:=(v_row->>'recovery_id')::uuid;
        if not exists(select 1 from public.recoveries r where r.id=v_ref and r.shop_id=v_shop)
           and not (
             exists(select 1 from jsonb_array_elements(coalesce(p_backup->'tables'->'recoveries','[]'::jsonb)) b
                    where b->>'id'=v_ref::text and b->>'shop_id'=v_shop::text)
             and not exists(select 1 from public.recoveries r where r.id=v_ref and r.shop_id<>v_shop)
           ) then
          raise exception 'invalid_recovery_reference:%',v_table;
        end if;
      end if;
    end loop;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_backup->'tables'->'agent_activity_log','[]'::jsonb))
  loop
    if nullif(v_row->>'task_id','') is not null then
      v_ref:=(v_row->>'task_id')::uuid;
      if not exists(select 1 from public.agent_tasks t where t.id=v_ref and t.shop_id=v_shop)
         and not (
           exists(select 1 from jsonb_array_elements(coalesce(p_backup->'tables'->'agent_tasks','[]'::jsonb)) b
                  where b->>'id'=v_ref::text and b->>'shop_id'=v_shop::text)
           and not exists(select 1 from public.agent_tasks t where t.id=v_ref and t.shop_id<>v_shop)
         ) then
        raise exception 'invalid_task_reference:agent_activity_log';
      end if;
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_backup->'tables'->'recoveries','[]'::jsonb))
  loop
    if nullif(v_row->>'ptp_id','') is not null then
      v_ref:=(v_row->>'ptp_id')::uuid;
      if not exists(select 1 from public.promises_to_pay p where p.id=v_ref and p.shop_id=v_shop)
         and not (
           exists(select 1 from jsonb_array_elements(coalesce(p_backup->'tables'->'promises_to_pay','[]'::jsonb)) b
                  where b->>'id'=v_ref::text and b->>'shop_id'=v_shop::text)
           and not exists(select 1 from public.promises_to_pay p where p.id=v_ref and p.shop_id<>v_shop)
         ) then
        raise exception 'invalid_ptp_reference:recoveries';
      end if;
    end if;
  end loop;

  -- Break the only circular reference; it is restored after recoveries exist.
  v_rows:=coalesce(p_backup->'tables'->'promises_to_pay','[]'::jsonb);
  select coalesce(jsonb_agg(value-'kept_recovery_id'),'[]'::jsonb) into v_rows
    from jsonb_array_elements(v_rows);
  execute 'insert into public.settings select * from jsonb_populate_recordset(null::public.settings,$1) on conflict do nothing'
    using coalesce(p_backup->'tables'->'settings','[]'::jsonb);
  execute 'insert into public.customers select * from jsonb_populate_recordset(null::public.customers,$1) on conflict do nothing'
    using coalesce(p_backup->'tables'->'customers','[]'::jsonb);
  execute 'insert into public.customer_invoices select * from jsonb_populate_recordset(null::public.customer_invoices,$1) on conflict do nothing'
    using coalesce(p_backup->'tables'->'customer_invoices','[]'::jsonb);
  execute 'insert into public.promises_to_pay select * from jsonb_populate_recordset(null::public.promises_to_pay,$1) on conflict do nothing'
    using v_rows;
  execute 'insert into public.recoveries select * from jsonb_populate_recordset(null::public.recoveries,$1) on conflict do nothing'
    using coalesce(p_backup->'tables'->'recoveries','[]'::jsonb);

  for v_row in select value from jsonb_array_elements(coalesce(p_backup->'tables'->'promises_to_pay','[]'::jsonb))
  loop
    if nullif(v_row->>'kept_recovery_id','') is not null then
      update public.promises_to_pay p
      set kept_recovery_id=(v_row->>'kept_recovery_id')::uuid
      where p.id=(v_row->>'id')::uuid and p.shop_id=v_shop
        and exists(select 1 from public.recoveries r where r.id=(v_row->>'kept_recovery_id')::uuid and r.shop_id=v_shop);
    end if;
  end loop;

  foreach v_table in array array['customer_balances','agent_tasks','agent_activity_log','reminder_queue','payment_links','legal_notices','escalations','receipts','erp_sync_log','reminder_rules']
  loop
    v_rows:=coalesce(p_backup->'tables'->v_table,'[]'::jsonb);
    execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I,$1) on conflict do nothing',v_table,v_table)
      using v_rows;
  end loop;

  foreach v_table in array array['settings','customers','customer_invoices','promises_to_pay','recoveries','customer_balances','agent_tasks','agent_activity_log','reminder_queue','payment_links','legal_notices','escalations','receipts','erp_sync_log','reminder_rules']
  loop
    v_counts:=v_counts||jsonb_build_object(v_table,jsonb_array_length(coalesce(p_backup->'tables'->v_table,'[]'::jsonb)));
  end loop;
  insert into public.audit_log(shop_id,user_id,username,action,entity_type,details)
  values(v_shop,v_user.id,v_user.username,'backup_restore','shop',v_counts::text);
  return jsonb_build_object('ok',true,'shop_id',v_shop,'processed',v_counts);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_save_settings(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype; v_row public.settings%rowtype; v_extra jsonb;
begin
  perform public.app_require_permission(p_token,'settings');
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.shop_id is null then raise exception 'access_denied'; end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.app_set_business_type(p_token text, p_shop_id uuid, p_business_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor public.users%rowtype;
  v_shop public.shops%rowtype;
  v_type text;
begin
  perform public.app_require_permission(p_token,'settings');
  select u.* into v_actor
  from public.app_sessions s
  join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active=true;

  if not found or v_actor.role<>'super_admin' then
    raise exception 'access_denied';
  end if;

  v_type:=coalesce(nullif(trim(p_business_type),''),'Other');
  if v_type not in (
    'Jewellery','Finance / Loan','Electronics','Furniture','Automobile',
    'Wholesale / Distribution','Education / Fees','Real Estate','Services','Other'
  ) then
    raise exception 'invalid_business_type';
  end if;

  update public.shops
     set business_type=v_type
   where id=p_shop_id
   returning * into v_shop;

  if not found then raise exception 'business_not_found'; end if;

  insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
  values(v_shop.id,v_actor.id,v_actor.username,'business.type.update','business',
         v_shop.id::text,'Business type changed to '||v_type);

  return to_jsonb(v_shop)-'razorpay_key_secret'-'whatsapp_api_key'-'sms_api_key';
end
$function$
;

CREATE OR REPLACE FUNCTION public.app_get_users(p_token text)
 RETURNS TABLE(id uuid, username text, role text, shop_id uuid, display_name text, is_active boolean, is_field_agent boolean, mobile text, agent_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype;
begin
  perform public.app_require_permission(p_token,'manage_users');
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  return query select u.id,u.username,u.role,u.shop_id,u.display_name,u.is_active,
    coalesce(u.is_field_agent,false),u.mobile,u.agent_code from public.users u
    where (v_user.role='super_admin' or u.shop_id=v_user.shop_id)
    order by u.username;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_create_user(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor public.users%rowtype; v_role text; v_shop uuid; v_row public.users%rowtype; v_password text;
begin
  perform public.app_require_permission(p_token,'manage_users');
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
  if v_role='user' then
   insert into public.user_permissions(user_id,permissions) values(v_row.id,
    '{"view":true,"add":false,"modify":false,"delete":false,"settings":false,"backup":false,"restore":false}'::jsonb);
  end if;
  return jsonb_build_object('id',v_row.id,'username',v_row.username,'role',v_row.role,
    'shop_id',v_row.shop_id,'display_name',v_row.display_name,'is_active',v_row.is_active);
end $function$
;

CREATE OR REPLACE FUNCTION public.app_delete_user(p_token text, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor public.users%rowtype; v_target public.users%rowtype;
begin
  perform public.app_require_permission(p_token,'manage_users');
  select u.* into v_actor from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  select * into v_target from public.users where id=p_user_id;
  if not found or v_actor.id=v_target.id or v_target.role='super_admin' then raise exception 'access_denied'; end if;
  if v_actor.role='super_admin' or
     (v_actor.role='admin' and v_target.role='user' and v_target.shop_id=v_actor.shop_id) then
    delete from public.users where id=v_target.id;
  else raise exception 'access_denied'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_set_agent_credentials(p_token text, p_user_id uuid, p_code text, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype;
begin
  perform public.app_require_permission(p_token,'manage_users');
 select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() and u.is_active;
 if not found or v_user.role<>'admin' then raise exception 'access_denied'; end if;
 if coalesce(p_code,'') !~ '^[A-Za-z0-9_-]{3,30}$' or length(coalesce(p_pin,''))<6 then raise exception 'invalid_credentials'; end if;
 update public.users set agent_code=upper(trim(p_code)),field_pin=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),is_field_agent=true
  where id=p_user_id and shop_id=v_user.shop_id and role='user';
 if not found then raise exception 'user_not_found'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.app_get_audit(p_token text, p_limit integer DEFAULT 100)
 RETURNS SETOF audit_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype;
begin
  perform public.app_require_permission(p_token,'manage_users');
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.role not in ('admin','super_admin') then raise exception 'access_denied'; end if;
  return query select * from public.audit_log a where
    (v_user.role='super_admin' or a.shop_id=v_user.shop_id)
    order by a.created_at desc limit greatest(1,least(coalesce(p_limit,100),500));
end $function$
;

CREATE OR REPLACE FUNCTION public.app_save_customer(p_token text, p_customer_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_shop uuid; v_row public.customers%rowtype;
begin
  perform public.app_require_permission(p_token,case when p_customer_id is null then 'add' else 'modify' end);
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
end $function$
;

CREATE OR REPLACE FUNCTION public.app_collection(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype; v_id uuid; v_ptp public.promises_to_pay%rowtype;
  v_esc public.escalations%rowtype; v_status text;
begin
  perform public.app_require_permission(p_token,case
 when p_action in ('ptp_list','escalation_list') then 'view'
 when p_action='ptp_save' then case when nullif(p_payload->>'id','') is null then 'add' else 'modify' end
 when p_action in ('ptp_status','escalation_update') then 'modify'
 when p_action='ptp_delete' then 'delete' else null end);
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
    -- Delete permission was checked above.
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
end $function$
;

CREATE OR REPLACE FUNCTION public.app_records(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype; v_customer public.customers%rowtype; v_agent public.users%rowtype;
  v_activity public.agent_activity_log%rowtype; v_notice public.legal_notices%rowtype;
  v_link public.payment_links%rowtype; v_receipt public.receipts%rowtype; v_limit int; v_no text;
begin
  perform public.app_require_permission(p_token,case
 when p_action='activity_list' then 'view'
 when p_action in ('activity_add','legal_add','payment_link_add','receipt_add') then 'add'
 when p_action='assign_agent' then 'modify'
 when p_action='set_field_agent' then 'manage_users' else null end);
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_user.shop_id is null then raise exception 'invalid_session'; end if;

  if p_action='assign_agent' then
    -- Modify permission checked above.
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
end $function$
;

CREATE OR REPLACE FUNCTION public.app_aging(p_token text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype; v_result jsonb; v_count int:=0; r record;
begin
  perform public.app_require_permission(p_token,case when p_action in ('summary','recalc') then 'view' when p_action='broken_ptp' then 'modify' else null end);
 select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() and u.is_active;
 if not found or v_user.shop_id is null then raise exception 'invalid_session'; end if;
 if p_action='summary' then
   select to_jsonb(x) into v_result from public.shop_aging_summary(v_user.shop_id) x;
   return coalesce(v_result,'{}'::jsonb);
 elsif p_action='recalc' then
   perform public.recalc_all_aging(v_user.shop_id);return jsonb_build_object('ok',true);
 elsif p_action='broken_ptp' then
   -- Delegated permission checked above.
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
end $function$
;

CREATE OR REPLACE FUNCTION public.app_field_customers(p_token text)
 RETURNS TABLE(id uuid, name text, village text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select c.id,c.name,c.village from public.field_sessions fs
  join public.users u on u.id=fs.agent_id
  join public.shops sh on sh.id=u.shop_id and sh.is_active=true
  join public.customers c on c.shop_id=u.shop_id
    and trim(coalesce(c.executive,''))=trim(coalesce(u.display_name,''))
  where fs.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and fs.expires_at>now() and u.is_active=true and u.is_field_agent=true
    and not coalesce((select maintenance_mode from public.system_config where id=1),false)
    and (sh.license_expiry is null or sh.license_expiry>=current_date)
    and (public.app_permissions_for_user(u.id)->>'view')::boolean is true
  order by c.name
$function$
;

CREATE OR REPLACE FUNCTION public.app_field_checkin(p_token text, p_customer_id uuid, p_activity_type text, p_notes text, p_lat numeric, p_lng numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user public.users%rowtype; v_ok boolean;
begin
  select u.* into v_user from public.field_sessions fs join public.users u on u.id=fs.agent_id
   join public.shops sh on sh.id=u.shop_id and sh.is_active=true
   where fs.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and fs.expires_at>now()
     and u.is_active=true and u.is_field_agent=true
     and not coalesce((select maintenance_mode from public.system_config where id=1),false)
     and (sh.license_expiry is null or sh.license_expiry>=current_date);
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if (public.app_permissions_for_user(v_user.id)->>'view')::boolean is distinct from true or (public.app_permissions_for_user(v_user.id)->>'add')::boolean is distinct from true then raise exception 'permission_denied:field_access'; end if;
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
end $function$
;

create or replace function public.app_update_recovery(p_token text,p_recovery_id uuid,p_expected_amount numeric,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session jsonb; v_shop uuid; v_row public.recoveries%rowtype; v_customer public.customers%rowtype; v_amount numeric; v_before jsonb;
begin
 perform public.app_require_permission(p_token,'modify');
 v_session:=public.app_validate_session(p_token);v_shop:=(v_session->'user'->>'shop_id')::uuid;
 select * into v_row from public.recoveries where id=p_recovery_id and shop_id=v_shop for update;
 if not found then raise exception 'recovery_not_found'; end if;
 if v_row.amount is distinct from p_expected_amount then raise exception 'recovery_changed_refresh_and_retry'; end if;
 v_before:=to_jsonb(v_row);
 select * into v_customer from public.customers where id=v_row.customer_id and shop_id=v_shop for update;
 if not found then raise exception 'customer_not_found'; end if;
 v_amount:=(p_payload->>'amount')::numeric;
 if v_amount is null or v_amount<0 or v_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_amount'; end if;
 if v_amount<>round(v_amount,2) then raise exception 'amount_requires_two_decimals'; end if;
 if v_amount>v_customer.outstanding+v_row.amount then raise exception 'amount_exceeds_outstanding'; end if;
 if v_amount=0 and length(trim(coalesce(p_payload->>'remarks','')))=0 then raise exception 'remarks_required'; end if;
 if coalesce(p_payload->>'payment_mode','') not in ('Cash','UPI','Bank Transfer','Cheque','Card') then raise exception 'invalid_payment_mode'; end if;
 if nullif(p_payload->>'recovery_date','') is null then raise exception 'date_required'; end if;
 update public.customers set outstanding=outstanding+v_row.amount-v_amount,updated_at=now() where id=v_customer.id;
 update public.recoveries set amount=v_amount,recovery_date=(p_payload->>'recovery_date')::date,
 payment_mode=p_payload->>'payment_mode',receipt_no=left(coalesce(p_payload->>'receipt_no',''),100),
 collected_by=left(coalesce(p_payload->>'collected_by',''),150),remarks=left(coalesce(p_payload->>'remarks',''),2000)
 where id=v_row.id returning * into v_row;
 update public.receipts set amount=v_row.amount,receipt_no=case when trim(v_row.receipt_no)<>'' then v_row.receipt_no else receipt_no end where recovery_id=v_row.id and shop_id=v_shop;
 insert into public.audit_log(shop_id,user_id,username,action,entity_type,entity_id,details)
 values(v_shop,(v_session->'user'->>'id')::uuid,v_session->'user'->>'username','recovery_modified','recovery',v_row.id::text,
 jsonb_build_object('previous_amount',v_before->'amount','new_amount',v_row.amount)::text);
 return to_jsonb(v_row);
end $$;
revoke all on function public.app_update_recovery(text,uuid,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.app_update_recovery(text,uuid,numeric,jsonb) to anon,authenticated;
