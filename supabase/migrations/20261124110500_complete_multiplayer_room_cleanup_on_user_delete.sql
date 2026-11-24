-- Complete user-deletion cleanup for legacy and current multiplayer rooms.
-- The room-leave helper keeps surviving rooms playable and updates host/player counts
-- before the Auth row and its membership rows are cascaded.

alter table public.game_online_rooms
  alter column host_user_id drop not null;

alter table public.game_online_rooms
  add constraint game_online_rooms_host_user_auth_fkey
  foreign key (host_user_id) references auth.users(id) on delete set null;

alter table public.game_online_room_messages
  add constraint game_online_room_messages_sender_auth_fkey
  foreign key (sender_user_id) references auth.users(id) on delete cascade;

alter table public.werewolf_rooms
  add constraint werewolf_rooms_host_auth_fkey
  foreign key (host_uid) references auth.users(id) on delete cascade;

create index if not exists game_online_rooms_host_user_auth_idx
  on public.game_online_rooms(host_user_id);
create index if not exists game_online_room_messages_sender_auth_idx
  on public.game_online_room_messages(sender_user_id);
create index if not exists werewolf_rooms_host_auth_idx
  on public.werewolf_rooms(host_uid);

create or replace function private.kuro_prepare_user_room_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_room record;
  v_next_host uuid;
  v_remaining integer;
begin
  -- Use the same authoritative leave routine used by normal multiplayer exits.
  -- This recalculates player_count, hands off the host when possible, and removes
  -- waiting-room votes and finished matchmaking entries where appropriate.
  for v_room in
    select r.id, r.game_id
    from public.game_online_room_members m
    join public.game_online_rooms r on r.id = m.room_id
    where m.user_id = p_user_id
    order by r.id
  loop
    perform public.kuro_leave_online_room(v_room.id, p_user_id);

    -- Keep Werewolf's JSON player list and private session state synchronized
    -- with the membership table before the Auth user disappears.
    if v_room.game_id = '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid then
      perform public.kuro_werewolf_sync_room(v_room.id);
    end if;
  end loop;

  -- Repair any inconsistent/stale host reference even if the deleted account
  -- was recorded as host without a corresponding membership row.
  for v_room in
    select r.id, r.game_id
    from public.game_online_rooms r
    where r.host_user_id = p_user_id
    order by r.id
  loop
    select count(*)::integer, (array_agg(m.user_id order by m.joined_at, m.user_id))[1]
      into v_remaining, v_next_host
    from public.game_online_room_members m
    where m.room_id = v_room.id;

    update public.game_online_rooms r
    set host_user_id = v_next_host,
        player_count = coalesce(v_remaining, 0),
        status = case when coalesce(v_remaining, 0) = 0 then 'closed' else r.status end,
        game_data = case
          when v_room.game_id = '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid
          then jsonb_set(
            coalesce(r.game_data, '{}'::jsonb),
            '{hostUid}',
            coalesce(to_jsonb(v_next_host::text), 'null'::jsonb),
            true
          )
          else r.game_data
        end
    where r.id = v_room.id;
  end loop;
end;
$function$;

revoke all on function private.kuro_prepare_user_room_deletion(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.kuro_before_auth_user_delete_rooms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.kuro_prepare_user_room_deletion(old.id);
  return old;
end;
$function$;

revoke all on function private.kuro_before_auth_user_delete_rooms()
  from public, anon, authenticated, service_role;

drop trigger if exists kuro_before_auth_user_delete_rooms on auth.users;
create trigger kuro_before_auth_user_delete_rooms
before delete on auth.users
for each row
execute function private.kuro_before_auth_user_delete_rooms();
