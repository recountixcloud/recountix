create or replace function public.app_change_own_password(p_token text,p_current_password text,p_new_password text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype;
begin
 select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
 where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now() and u.is_active=true;
 if not found then raise exception 'invalid_session'; end if;
 if length(coalesce(p_new_password,''))<8 then raise exception 'weak_password'; end if;
 return public.app_update_own_profile(p_token,p_current_password,v_user.username,p_new_password,v_user.recovery_email);
end $$;
revoke all on function public.app_change_own_password(text,text,text) from public;
grant execute on function public.app_change_own_password(text,text,text) to anon,authenticated;
