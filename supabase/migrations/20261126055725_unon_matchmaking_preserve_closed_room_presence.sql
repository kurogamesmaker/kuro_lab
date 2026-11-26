CREATE OR REPLACE FUNCTION public.kuro_unon_matchmaking_join(
  p_game_id uuid,
  p_user_id uuid,
  p_rule_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_existing public.game_online_matchmaking;
  v_room public.game_online_rooms;
  v_live_count integer;
BEGIN
  IF p_game_id <> 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid THEN
    RAISE EXCEPTION 'INVALID_MATCH_GAME';
  END IF;
  IF p_rule_mode NOT IN ('official', 'local') THEN
    RAISE EXCEPTION 'INVALID_MATCH_RULE';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_game_id::text, 0)
  );

  DELETE FROM public.game_online_matchmaking AS q
  WHERE q.game_id = p_game_id
    AND q.status = 'waiting'
    AND q.last_seen_at < now() - interval '45 seconds';

  SELECT * INTO v_existing
  FROM public.game_online_matchmaking
  WHERE game_id = p_game_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'matched' AND v_existing.room_id IS NOT NULL THEN
    SELECT * INTO v_room
    FROM public.game_online_rooms
    WHERE id = v_existing.room_id
      AND game_id = p_game_id
    FOR UPDATE;

    IF FOUND AND v_room.status = 'playing' THEN
      RETURN pg_catalog.jsonb_build_object('status', 'matched', 'room_id', v_room.id);
    END IF;

    IF FOUND AND v_room.status = 'waiting' AND v_room.expires_at > now() THEN
      SELECT pg_catalog.count(*)::integer INTO v_live_count
      FROM public.game_online_room_members
      WHERE room_id = v_room.id
        AND last_seen_at >= now() - interval '60 seconds';

      IF v_live_count >= 2 THEN
        UPDATE public.game_online_matchmaking
        SET last_seen_at = now()
        WHERE game_id = p_game_id AND user_id = p_user_id;
        RETURN pg_catalog.jsonb_build_object('status', 'matched', 'room_id', v_room.id);
      END IF;

      UPDATE public.game_online_rooms
      SET status = 'closed', player_count = 0
      WHERE id = v_room.id AND game_id = p_game_id AND status = 'waiting';
      -- Preserve members so they can observe roomStatus='closed' via room_poll.
    END IF;

    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id AND room_id = v_existing.room_id;
  END IF;

  INSERT INTO public.game_online_matchmaking (
    game_id, user_id, status, room_id, created_at, last_seen_at, matched_at, match_rule
  ) VALUES (
    p_game_id, p_user_id, 'waiting', NULL, now(), now(), NULL, p_rule_mode
  )
  ON CONFLICT (game_id, user_id) DO UPDATE
  SET status = 'waiting',
      room_id = NULL,
      created_at = now(),
      last_seen_at = now(),
      matched_at = NULL,
      match_rule = EXCLUDED.match_rule;

  PERFORM public.kuro_unon_matchmaking_try_match(p_game_id, p_rule_mode);

  SELECT * INTO v_existing
  FROM public.game_online_matchmaking
  WHERE game_id = p_game_id AND user_id = p_user_id;

  IF FOUND AND v_existing.status = 'matched' AND v_existing.room_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'matched', 'room_id', v_existing.room_id);
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'waiting');
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_unon_matchmaking_cancel(
  p_game_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_queue public.game_online_matchmaking;
  v_room_status text;
BEGIN
  IF p_game_id <> 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid THEN
    RAISE EXCEPTION 'INVALID_MATCH_GAME';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_game_id::text, 0)
  );

  SELECT * INTO v_queue
  FROM public.game_online_matchmaking
  WHERE game_id = p_game_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_queue.status = 'matched' AND v_queue.room_id IS NOT NULL THEN
    SELECT status INTO v_room_status
    FROM public.game_online_rooms
    WHERE id = v_queue.room_id AND game_id = p_game_id
    FOR UPDATE;

    IF v_room_status = 'playing' THEN
      RETURN false;
    END IF;

    UPDATE public.game_online_rooms
    SET status = 'closed', player_count = 0
    WHERE id = v_queue.room_id AND game_id = p_game_id AND status = 'waiting';

    -- Preserve membership rows so active clients can poll and close cleanly.
    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id AND room_id = v_queue.room_id;
  ELSE
    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id AND user_id = p_user_id;
  END IF;

  RETURN true;
END;
$function$;