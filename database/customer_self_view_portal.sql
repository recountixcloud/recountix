-- Customer self-view portal: secure read-only summary by business code + mobile + portal PIN.
alter table public.customers add column if not exists portal_pin_hash text;

create or replace function public.app_set_customer_portal_pin(p_token text,p_customer_id uuid,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;

create or replace function public.app_customer_self_view(p_shop_code text,p_mobile text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;

revoke all on function public.app_set_customer_portal_pin(text,uuid,text) from public;
revoke all on function public.app_customer_self_view(text,text,text) from public;
grant execute on function public.app_set_customer_portal_pin(text,uuid,text) to anon,authenticated;
grant execute on function public.app_customer_self_view(text,text,text) to anon,authenticated;
