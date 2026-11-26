
create or replace function private.kuro_store_is_studio_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    exists (
      select 1
      from public.kuro_store_studio_members m
      where m.user_id = auth.uid()
        and m.is_active = true
    )
    and not exists (
      select 1
      from public.account_suspensions s
      where s.user_id = auth.uid()
        and s.revoked_at is null
        and s.starts_at <= now()
        and s.ends_at > now()
    );
$function$;
revoke all on function private.kuro_store_is_studio_member() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.kuro_store_is_studio_member() to authenticated;
