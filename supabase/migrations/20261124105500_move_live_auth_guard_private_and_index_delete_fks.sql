-- Keep the live-auth guard out of the exposed public RPC namespace.
-- RLS policies can call this private helper, but browser clients cannot invoke it through /rest/v1/rpc.

create or replace function private.kuro_auth_user_exists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
     and exists (
       select 1 from auth.users u
       where u.id = auth.uid()
         and u.deleted_at is null
     );
$function$;

revoke all on function private.kuro_auth_user_exists() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.kuro_auth_user_exists() to authenticated;

do $block$
declare r record;
begin
  for r in
    select distinct c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relrowsecurity
      and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
  loop
    execute format('drop policy if exists kuro_require_live_auth_user on public.%I',r.table_name);
    execute format(
      'create policy kuro_require_live_auth_user on public.%I as restrictive for all to authenticated using ((select private.kuro_auth_user_exists())) with check ((select private.kuro_auth_user_exists()))',
      r.table_name
    );
  end loop;
end;
$block$;

drop policy if exists kuro_require_live_auth_user on storage.objects;
create policy kuro_require_live_auth_user on storage.objects
as restrictive for all to authenticated
using ((select private.kuro_auth_user_exists()))
with check ((select private.kuro_auth_user_exists()));

drop policy if exists kuro_require_live_auth_user on realtime.messages;
create policy kuro_require_live_auth_user on realtime.messages
as restrictive for all to authenticated
using ((select private.kuro_auth_user_exists()))
with check ((select private.kuro_auth_user_exists()));

drop function public.kuro_auth_user_exists();

-- Index the account-id side of the new cascading foreign keys. Composite
-- primary keys and leaderboard indexes did not have user_id as their first key.
create index if not exists game_daifugo_room_ready_user_auth_idx
  on public.game_daifugo_room_ready(user_id);
create index if not exists game_online_matchmaking_user_auth_idx
  on public.game_online_matchmaking(user_id);
create index if not exists game_sevens_results_user_auth_idx
  on public.game_sevens_results(user_id);
create index if not exists game_sevens_room_votes_user_auth_idx
  on public.game_sevens_room_votes(user_id);
create index if not exists kuro_game_win_events_user_auth_idx
  on public.kuro_game_win_events(user_id);
create index if not exists werewolf_chat_messages_user_auth_idx
  on public.werewolf_chat_messages(user_id);
