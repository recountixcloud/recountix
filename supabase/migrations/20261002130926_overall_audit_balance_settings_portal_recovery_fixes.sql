CREATE OR REPLACE FUNCTION public.app_save_customer(p_token text, p_customer_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_shop uuid; v_row public.customers%rowtype; v_old public.customers%rowtype; v_bill numeric; v_down numeric; v_out numeric;
begin
  perform public.app_require_permission(p_token,case when p_customer_id is null then 'add' else 'modify' end);
  select u.shop_id into v_shop from public.app_sessions s join public.users u on u.id=s.user_id
   where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null
     and s.expires_at>now() and u.is_active=true;
  if not found or v_shop is null then raise exception 'invalid_session'; end if;
  if length(trim(coalesce(p_payload->>'name','')))<1 then raise exception 'name_required'; end if;
  if coalesce(p_payload->>'mobile','') !~ '^[0-9+ -]{10,16}$' then raise exception 'invalid_mobile'; end if;

  v_bill:=coalesce((p_payload->>'bill')::numeric,0);
  v_down:=coalesce((p_payload->>'down_payment')::numeric,0);
  if v_bill::text in ('NaN','Infinity','-Infinity') or v_down::text in ('NaN','Infinity','-Infinity')
     or v_bill<0 or v_down<0 or v_down>v_bill then raise exception 'invalid_bill_or_down_payment'; end if;
  if v_bill<>round(v_bill,2) or v_down<>round(v_down,2) then raise exception 'amount_requires_two_decimals'; end if;
  if p_customer_id is null then
    v_out:=v_bill-v_down;
  else
    select * into v_old from public.customers where id=p_customer_id and shop_id=v_shop for update;
    if not found then raise exception 'customer_not_found'; end if;
    -- Preserve already collected payments and imported opening balances.
    v_out:=v_old.outstanding+(v_bill-v_old.bill)-(v_down-v_old.down_payment);
    if v_out<0 then raise exception 'bill_below_paid_amount'; end if;
  end if;

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
      v_out,left(coalesce(p_payload->>'executive',''),150),
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
      down_payment=v_down,outstanding=v_out,
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
end $function$;


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
  if v_amount<0 or v_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_amount'; end if;
  if v_amount<>round(v_amount,2) then raise exception 'amount_requires_two_decimals'; end if;
  if coalesce(p_payload->>'payment_mode','Cash') not in ('Cash','UPI','Bank Transfer','Cheque','Card') then raise exception 'invalid_payment_mode'; end if;
  select * into v_customer from public.customers where id=(p_payload->>'customer_id')::uuid
    and shop_id=v_shop for update;
  if not found then raise exception 'customer_not_found'; end if;

  if v_amount=0 and length(trim(coalesce(p_payload->>'remarks','')))=0 then raise exception 'remarks_required'; end if;
  v_request_key:=left(regexp_replace(coalesce(p_payload->>'request_key',''),'[^A-Za-z0-9._:-]','','g'),120);
  v_receipt_no:=left(coalesce(p_payload->>'receipt_no',''),100);

  if v_request_key<>'' then
    select * into v_row from public.recoveries
     where shop_id=v_shop
       and request_key=v_request_key
     order by created_at desc limit 1;
    if found then
      if v_row.customer_id is distinct from v_customer.id or v_row.amount is distinct from v_amount then raise exception 'request_key_conflict'; end if;
      return to_jsonb(v_row);
    end if;
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

  if v_amount>v_customer.outstanding then raise exception 'amount_exceeds_outstanding'; end if;

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
end $function$;


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
  v_extra:=coalesce((select extra from public.settings where shop_id=v_user.shop_id),'{}'::jsonb)||jsonb_build_object('executives',
    case when jsonb_typeof(p_payload->'executives')='array' then p_payload->'executives' else '[]'::jsonb end,
    'upi_id',left(coalesce(p_payload->>'upiId',''),150),
    'website',left(coalesce(p_payload->>'website',''),500));
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
end $function$;


CREATE OR REPLACE FUNCTION public.app_reset_password_by_recovery(p_username text, p_recovery_email text, p_new_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
begin
  -- Email knowledge does not prove email ownership. Keep this public entry
  -- fail-closed until a verified, expiring recovery token is implemented.
  return jsonb_build_object('error','verified_recovery_required');
end;
$function$;


CREATE OR REPLACE FUNCTION public.app_customer_self_view(p_shop_code text, p_mobile text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_shop public.shops%rowtype;
  v_customer public.customers%rowtype;
  v_paid numeric:=0;
  v_last public.recoveries%rowtype;
  v_recent jsonb:='[]'::jsonb;
  v_mobile text; v_key text; v_maintenance boolean;
begin
  v_mobile:=regexp_replace(coalesce(p_mobile,''),'[^0-9]','','g');
  if length(trim(coalesce(p_shop_code,'')))<1 or length(v_mobile)<10 or length(coalesce(p_pin,''))<4 then
    return jsonb_build_object('error','invalid_input');
  end if;
  v_key:='portal:'||encode(extensions.digest(lower(trim(p_shop_code))||':'||right(v_mobile,10),'sha256'),'hex');
  if exists(select 1 from public.login_attempts where username=v_key and locked_until>now()) then
    return jsonb_build_object('error','temporarily_locked');
  end if;
  insert into public.login_attempts(username,failed_count,locked_until,last_attempt_at)
  values(v_key,1,null,now()) on conflict(username) do update
    set failed_count=case when public.login_attempts.last_attempt_at<now()-interval '15 minutes' then 1 else public.login_attempts.failed_count+1 end,
    locked_until=case when public.login_attempts.last_attempt_at>=now()-interval '15 minutes' and public.login_attempts.failed_count+1>=5 then now()+interval '15 minutes' else null end,
    last_attempt_at=now();
  select coalesce(maintenance_mode,false) into v_maintenance from public.system_config where id=1;
  if coalesce(v_maintenance,false) then return jsonb_build_object('error','maintenance_mode'); end if;
  select * into v_shop from public.shops
  where lower(code)=lower(trim(p_shop_code)) and coalesce(is_active,true)=true and (license_expiry is null or license_expiry>=current_date) limit 1;
  if not found then return jsonb_build_object('error','not_found'); end if;

  select * into v_customer
  from public.customers c
  where c.shop_id=v_shop.id
    and c.portal_pin_hash is not null
    and (
      right(regexp_replace(coalesce(c.mobile,''),'[^0-9]','','g'),10)=right(v_mobile,10)
      or right(regexp_replace(coalesce(c.alt_mobile,''),'[^0-9]','','g'),10)=right(v_mobile,10)
    )
  order by c.created_at desc
  limit 1;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if extensions.crypt(p_pin,v_customer.portal_pin_hash)<>v_customer.portal_pin_hash then
    return jsonb_build_object('error','not_found');
  end if;

  delete from public.login_attempts where username=v_key;
  select coalesce(sum(r.amount),0) into v_paid
  from public.recoveries r where r.shop_id=v_shop.id and r.customer_id=v_customer.id;

  select * into v_last from public.recoveries r
  where r.shop_id=v_shop.id and r.customer_id=v_customer.id
  order by r.recovery_date desc,r.created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'amount',x.amount,'date',x.recovery_date,'mode',x.payment_mode,'receipt_no',x.receipt_no
  ) order by x.recovery_date desc,x.created_at desc),'[]'::jsonb)
  into v_recent
  from (
    select amount,recovery_date,payment_mode,receipt_no,created_at
    from public.recoveries
    where shop_id=v_shop.id and customer_id=v_customer.id
    order by recovery_date desc,created_at desc limit 5
  ) x;

  return jsonb_build_object(
    'business_name',v_shop.name,
    'customer_name',v_customer.name,
    'bill_amount',coalesce(v_customer.bill,0),
    'paid_amount',coalesce(v_paid,0)+coalesce(v_customer.down_payment,0),
    'pending_amount',coalesce(v_customer.outstanding,0),
    'last_payment_date',v_last.recovery_date,
    'status',coalesce(v_customer.status,'Active'),
    'recent_payments',v_recent
  );
end $function$;
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
    if v_status not in ('open','in_progress','resolved','dismissed') then raise exception 'invalid_status'; end if;
    update public.escalations set status=v_status,level=greatest(1,least(coalesce((p_payload->>'level')::int,level),10)),
      notes=left(coalesce(p_payload->>'notes',notes),2000),updated_at=now()
      where id=v_id and shop_id=v_user.shop_id returning * into v_esc;
    if not found then raise exception 'escalation_not_found'; end if;
    return to_jsonb(v_esc);
  end if;
  raise exception 'invalid_action';
end $function$;
CREATE OR REPLACE FUNCTION public.app_update_user_access(p_token text, p_user_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 update public.users set username=v_username,display_name=left(coalesce(nullif(trim(p_payload->>'display_name'),''),nullif(v_target.display_name,''),v_username),150),is_active=v_active where id=v_target.id;
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
end $function$;
