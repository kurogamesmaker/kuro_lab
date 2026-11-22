-- KUROGAMES temporary multiplayer data retention.
-- Durable user data (accounts, profiles, scores, rankings, cloud saves, published games)
-- is intentionally outside this cleanup function.

create index if not exists game_online_room_members_last_seen_cleanup_idx
  on public.game_online_room_members (room_id, last_seen_at desc);

create index if not exists game_online_matchmaking_waiting_seen_cleanup_idx
  on public.game_online_matchmaking (last_seen_at)
  where status = 'waiting';

create index if not exists game_online_matchmaking_matched_at_cleanup_idx
  on public.game_online_matchmaking (matched_at)
  where status = 'matched';

create index if not exists werewolf_rooms_updated_cleanup_idx
  on public.werewolf_rooms (updated_at);

create or replace function public.kuro_cleanup_temporary_game_data(
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_refreshed_rooms integer := 0;
  v_deleted_matchmaking integer := 0;
  v_deleted_orphaned_matchmaking integer := 0;
  v_deleted_online_rooms integer := 0;
  v_deleted_werewolf_rooms integer := 0;
  v_would_refresh_rooms integer := 0;
  v_would_delete_matchmaking integer := 0;
  v_would_delete_online_rooms integer := 0;
  v_would_delete_werewolf_rooms integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('kuro_cleanup_temporary_game_data', 0)
  ) then
    return pg_catalog.jsonb_build_object('skipped', true, 'reason', 'cleanup_already_running');
  end if;

  -- Dry-run is read-only. It reports candidates but does not alter any row.
  if p_dry_run then
    select count(*)::integer
      into v_would_refresh_rooms
    from public.game_online_rooms r
    where r.status <> 'closed'
      and r.expires_at <= now() + interval '15 minutes'
      and exists (
        select 1
        from public.game_online_room_members m
        where m.room_id = r.id
          and m.last_seen_at >= now() - interval '10 minutes'
      );

    select count(*)::integer
      into v_would_delete_matchmaking
    from public.game_online_matchmaking q
    where (
      q.status = 'waiting'
      and q.last_seen_at < now() - interval '2 minutes'
    ) or (
      q.status = 'matched'
      and (
        q.matched_at is null
        or q.matched_at < now() - interval '15 minutes'
        or q.room_id is null
        or not exists (
          select 1
          from public.game_online_rooms r
          where r.id = q.room_id
            and r.status <> 'closed'
            and (
              r.expires_at > now()
              or exists (
                select 1
                from public.game_online_room_members m
                where m.room_id = r.id
                  and m.last_seen_at >= now() - interval '10 minutes'
              )
            )
        )
      )
    );

    select count(*)::integer
      into v_would_delete_online_rooms
    from public.game_online_rooms r
    where (
      (
        (r.status = 'closed' and r.created_at <= now() - interval '15 minutes')
        or r.expires_at <= now()
      )
      and not exists (
        select 1
        from public.game_online_room_members m
        where m.room_id = r.id
          and m.last_seen_at >= now() - interval '10 minutes'
      )
    ) or (
      r.created_at <= now() - interval '30 minutes'
      and not exists (
        select 1
        from public.game_online_room_members m
        where m.room_id = r.id
      )
    );

    select count(*)::integer
      into v_would_delete_werewolf_rooms
    from public.werewolf_rooms r
    where (
      r.status = 'gameover'
      and r.updated_at <= now() - interval '2 hours'
    ) or r.updated_at <= now() - interval '24 hours';

    return pg_catalog.jsonb_build_object(
      'dryRun', true,
      'wouldRefreshOnlineRooms', v_would_refresh_rooms,
      'wouldDeleteMatchmakingEntries', v_would_delete_matchmaking,
      'wouldDeleteOnlineRooms', v_would_delete_online_rooms,
      'wouldDeleteWerewolfRooms', v_would_delete_werewolf_rooms,
      'permanentDataTouched', false
    );
  end if;

  -- Keep a room joinable while at least one member is actively sending heartbeats.
  -- Refresh 15 minutes before expiry so the five-minute cron has a safety margin.
  update public.game_online_rooms r
  set expires_at = now() + interval '2 hours'
  where r.status <> 'closed'
    and r.expires_at <= now() + interval '15 minutes'
    and exists (
      select 1
      from public.game_online_room_members m
      where m.room_id = r.id
        and m.last_seen_at >= now() - interval '10 minutes'
    );
  get diagnostics v_refreshed_rooms = row_count;

  -- Remove abandoned queue entries. This includes stale waits and matched rows
  -- whose acknowledgement window elapsed or whose room is no longer usable.
  with stale_queue as (
    select q.game_id, q.user_id
    from public.game_online_matchmaking q
    where (
      q.status = 'waiting'
      and q.last_seen_at < now() - interval '2 minutes'
    ) or (
      q.status = 'matched'
      and (
        q.matched_at is null
        or q.matched_at < now() - interval '15 minutes'
        or q.room_id is null
        or not exists (
          select 1
          from public.game_online_rooms r
          where r.id = q.room_id
            and r.status <> 'closed'
            and (
              r.expires_at > now()
              or exists (
                select 1
                from public.game_online_room_members m
                where m.room_id = r.id
                  and m.last_seen_at >= now() - interval '10 minutes'
              )
            )
        )
      )
    )
    order by q.last_seen_at asc
    limit 500
    for update skip locked
  )
  delete from public.game_online_matchmaking q
  using stale_queue s
  where q.game_id = s.game_id
    and q.user_id = s.user_id;
  get diagnostics v_deleted_matchmaking = row_count;

  -- A closed/expired room is deleted only after its members stop sending
  -- heartbeats. Empty orphan rooms also receive a 30-minute grace period.
  with stale_rooms as (
    select r.id
    from public.game_online_rooms r
    where (
      (
        (r.status = 'closed' and r.created_at <= now() - interval '15 minutes')
        or r.expires_at <= now()
      )
      and not exists (
        select 1
        from public.game_online_room_members m
        where m.room_id = r.id
          and m.last_seen_at >= now() - interval '10 minutes'
      )
    ) or (
      r.created_at <= now() - interval '30 minutes'
      and not exists (
        select 1
        from public.game_online_room_members m
        where m.room_id = r.id
      )
    )
    order by r.expires_at asc, r.created_at asc
    limit 200
    for update skip locked
  )
  delete from public.game_online_rooms r
  using stale_rooms s
  where r.id = s.id;
  get diagnostics v_deleted_online_rooms = row_count;

  -- ON DELETE SET NULL on room_id leaves matched queue rows without a room.
  delete from public.game_online_matchmaking q
  where q.status = 'matched'
    and q.room_id is null;
  get diagnostics v_deleted_orphaned_matchmaking = row_count;

  -- Werewolf rooms are temporary: game-over rooms retain a short 2-hour
  -- grace period; any room untouched for 24 hours is abandoned.
  with stale_werewolf_rooms as (
    select r.room_code
    from public.werewolf_rooms r
    where (
      r.status = 'gameover'
      and r.updated_at <= now() - interval '2 hours'
    ) or r.updated_at <= now() - interval '24 hours'
    order by r.updated_at asc
    limit 100
    for update skip locked
  )
  delete from public.werewolf_rooms r
  using stale_werewolf_rooms s
  where r.room_code = s.room_code;
  get diagnostics v_deleted_werewolf_rooms = row_count;

  return pg_catalog.jsonb_build_object(
    'dryRun', false,
    'refreshedOnlineRooms', v_refreshed_rooms,
    'deletedMatchmakingEntries', v_deleted_matchmaking,
    'deletedOrphanedMatchmakingEntries', v_deleted_orphaned_matchmaking,
    'deletedOnlineRooms', v_deleted_online_rooms,
    'deletedWerewolfRooms', v_deleted_werewolf_rooms,
    'permanentDataTouched', false
  );
end;
$function$;

revoke all on function public.kuro_cleanup_temporary_game_data(boolean)
  from public, anon, authenticated;
grant execute on function public.kuro_cleanup_temporary_game_data(boolean)
  to postgres;

comment on function public.kuro_cleanup_temporary_game_data(boolean) is
  'Dry-run capable, batched cleanup for temporary KUROGAMES multiplayer rooms and queues only. Never touches accounts, profiles, scores, rankings, cloud saves, or published games.';
