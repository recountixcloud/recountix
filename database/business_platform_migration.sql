-- Recountix generic multi-business platform migration
-- Safe to run repeatedly.

alter table public.shops
  add column if not exists business_type text not null default 'Other';

alter table public.shops
  drop constraint if exists shops_business_type_check;

alter table public.shops
  add constraint shops_business_type_check
  check (business_type in (
    'Jewellery','Finance / Loan','Electronics','Furniture','Automobile',
    'Wholesale / Distribution','Education / Fees','Real Estate','Services','Other'
  ));

create or replace function public.app_set_business_type(
  p_token text,
  p_shop_id uuid,
  p_business_type text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.users%rowtype;
  v_shop public.shops%rowtype;
  v_type text;
begin
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
$$;

revoke all on function public.app_set_business_type(text,uuid,text) from public;
grant execute on function public.app_set_business_type(text,uuid,text) to anon, authenticated;
