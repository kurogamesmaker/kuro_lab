-- Tighten multiplayer room inactivity windows while preserving reconnect safety.
do $migration$
declare
  v_before text;
  v_after text;
  v_old text := $old$where (
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
    )$old$;
  v_new text := $new$where (
      (
        (r.status = 'closed' and r.created_at <= now() - interval '15 minutes')
        or (r.status = 'waiting' and r.created_at <= now() - interval '30 minutes')
        or (r.status = 'playing' and r.created_at <= now() - interval '15 minutes')
        or r.expires_at <= now()
      )
      and not exists (
        select 1
        from public.game_online_room_members m
        where m.room_id = r.id
          and m.last_seen_at >= now() - interval '15 minutes'
      )
    ) or (
      r.created_at <= now() - interval '30 minutes'
      and not exists (
        select 1
        from public.game_online_room_members m
        where m.room_id = r.id
      )
    )$new$;
  v_replacements integer;
begin
  v_before := pg_get_functiondef('public.kuro_cleanup_temporary_game_data(boolean)'::regprocedure);
  v_replacements := (
    length(v_before) - length(replace(v_before, v_old, ''))
  ) / length(v_old);
  if v_replacements <> 2 then
    raise exception 'Expected exactly 2 cleanup predicates to update, found %', v_replacements;
  end if;
  v_after := replace(v_before, v_old, v_new);
  execute v_after;
end;
$migration$;
