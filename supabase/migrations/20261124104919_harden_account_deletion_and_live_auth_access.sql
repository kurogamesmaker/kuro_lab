-- Harden account deletion, Storage ownership, game history cleanup and post-deletion JWT access.

delete from public.game_sevens_results g
where not exists (select 1 from auth.users u where u.id = g.user_id);

delete from public.kuro_game_win_events g
where not exists (select 1 from auth.users u where u.id = g.user_id);

alter table public.game_daifugo_room_ready
  add constraint game_daifugo_room_ready_user_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.game_online_matchmaking
  add constraint game_online_matchmaking_user_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.game_online_room_members
  add constraint game_online_room_members_user_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.game_sevens_results
  add constraint game_sevens_results_user_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.game_sevens_room_votes
  add constraint game_sevens_room_votes_user_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.kuro_game_win_events
  add constraint kuro_game_win_events_user_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.werewolf_chat_messages
  add constraint werewolf_chat_messages_user_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

create or replace function public.kuro_list_storage_objects_for_owner(p_user_id uuid)
returns table(bucket_id text, object_name text)
language sql stable security definer set search_path = ''
as $function$
  select o.bucket_id, o.name
  from storage.objects o
  where o.owner = p_user_id or o.owner_id = p_user_id::text;
$function$;
revoke all on function public.kuro_list_storage_objects_for_owner(uuid)
  from public, anon, authenticated;
grant execute on function public.kuro_list_storage_objects_for_owner(uuid)
  to service_role;

create or replace function public.kuro_auth_user_exists()
returns boolean language sql stable security definer set search_path = ''
as $function$
  select auth.uid() is not null
     and exists (select 1 from auth.users u where u.id = auth.uid() and u.deleted_at is null);
$function$;
revoke all on function public.kuro_auth_user_exists() from public, anon;
grant execute on function public.kuro_auth_user_exists() to authenticated;

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
      'create policy kuro_require_live_auth_user on public.%I as restrictive for all to authenticated using ((select public.kuro_auth_user_exists())) with check ((select public.kuro_auth_user_exists()))',
      r.table_name
    );
  end loop;
end;
$block$;

comment on function public.kuro_auth_user_exists() is
  'RLS guard: authenticated JWTs may access user-facing tables only while their Auth user row still exists.';
