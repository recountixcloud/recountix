-- Recountix session retention
create or replace function public.cleanup_stale_security_records()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  delete from public.app_sessions
   where (revoked_at is not null and revoked_at < now() - interval '7 days')
      or (expires_at < now() - interval '7 days');

  delete from public.login_attempts
   where last_attempt_at < now() - interval '30 days'
     and (locked_until is null or locked_until < now());

  return null;
end;
$$;

revoke all on function public.cleanup_stale_security_records() from public, anon, authenticated;

drop trigger if exists trg_cleanup_stale_security_records on public.app_sessions;
create trigger trg_cleanup_stale_security_records
before insert on public.app_sessions
for each statement execute function public.cleanup_stale_security_records();
