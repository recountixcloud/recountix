-- Recountix production hardening
-- Applied to Supabase project on 2026-09-15.
-- Internal helpers remain callable by trusted database-owned RPC/functions,
-- but cannot be invoked directly through the public Data API.

revoke execute on function public.compute_aging_bucket(date,date) from public, anon, authenticated;
revoke execute on function public.increment_ad_click(uuid) from public, anon, authenticated;
revoke execute on function public.next_receipt_no(uuid) from public, anon, authenticated;
revoke execute on function public.process_broken_ptp(integer) from public, anon, authenticated;
revoke execute on function public.recalc_all_aging(uuid) from public, anon, authenticated;
revoke execute on function public.recalc_customer_aging(uuid) from public, anon, authenticated;
revoke execute on function public.shop_aging_summary(uuid) from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter function public.compute_aging_bucket(date,date) set search_path = public, pg_temp;
alter function public.increment_ad_click(uuid) set search_path = public, pg_temp;
alter function public.next_receipt_no(uuid) set search_path = public, pg_temp;
alter function public.process_broken_ptp(integer) set search_path = public, pg_temp;
alter function public.recalc_all_aging(uuid) set search_path = public, pg_temp;
alter function public.recalc_customer_aging(uuid) set search_path = public, pg_temp;
alter function public.shop_aging_summary(uuid) set search_path = public, pg_temp;
