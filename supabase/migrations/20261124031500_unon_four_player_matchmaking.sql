-- UNON random matchmaking: group up to four players, with a ten-second fallback for groups of two or three.
CREATE OR REPLACE FUNCTION public.kuro_unon_matchmaking_try_match(
  p_game_id uuid,
  p_rule_mode text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_ids uuid[];
  v_player_count integer := 0;
  v_oldest_created_at timestamptz;
  v_room_id uuid;
  v_room_code text;
  v_host_user_id uuid;
  v_attempt integer;
  v_user_id uuid;
BEGIN
  IF p_game_id <> 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid
     OR p_rule_mode NOT IN ('official', 'local') THEN
    RAISE EXCEPTION 'INVALID_MATCH_RULE';
  END IF;

  SELECT
    pg_catalog.array_agg(candidate.user_id ORDER BY candidate.created_at, candidate.user_id),
    pg_catalog.count(*)::integer,
    pg_catalog.min(candidate.created_at)
  INTO v_user_ids, v_player_count, v_oldest_created_at
  FROM (
    SELECT q.user_id, q.created_at
    FROM public.game_online_matchmaking AS q
    WHERE q.game_id = p_game_id
      AND q.status = 'waiting'
      AND q.match_rule = p_rule_mode
      AND q.last_seen_at >= now() - interval '20 seconds'
    ORDER BY q.created_at ASC, q.user_id ASC
    LIMIT 4
    FOR UPDATE SKIP LOCKED
  ) AS candidate;

  IF v_player_count < 2 THEN
    RETURN NULL;
  END IF;

  -- Fill the table to four immediately. With only two or three players,
  -- release the group after the oldest queued player has waited ten seconds.
  IF v_player_count < 4
     AND v_oldest_created_at > now() - interval '10 seconds' THEN
    RETURN NULL;
  END IF;

  v_host_user_id := v_user_ids[1];
  v_room_id := NULL;

  FOR v_attempt IN 1..8 LOOP
    v_room_code := pg_catalog.substr(
      pg_catalog.upper(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
      1,
      6
    );

    INSERT INTO public.game_online_rooms (
      id, game_id, room_code, host_user_id,
      max_players, player_count, status, game_data
    ) VALUES (
      pg_catalog.gen_random_uuid(), p_game_id, v_room_code, v_host_user_id,
      4, v_player_count, 'waiting',
      pg_catalog.jsonb_build_object(
        'kind', 'unon-random-match',
        'ruleMode', p_rule_mode
      )
    )
    ON CONFLICT (room_code) DO NOTHING
    RETURNING id INTO v_room_id;

    IF FOUND THEN
      EXIT;
    END IF;
  END LOOP;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_ROOM_CREATE_FAILED';
  END IF;

  FOREACH v_user_id IN ARRAY v_user_ids LOOP
    INSERT INTO public.game_online_room_members (room_id, user_id, last_seen_at)
    VALUES (v_room_id, v_user_id, now())
    ON CONFLICT (room_id, user_id)
    DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
  END LOOP;

  UPDATE public.game_online_matchmaking
  SET status = 'matched',
      room_id = v_room_id,
      matched_at = now(),
      last_seen_at = now()
  WHERE game_id = p_game_id
    AND user_id = ANY(v_user_ids)
    AND status = 'waiting'
    AND match_rule = p_rule_mode;

  RETURN v_room_id;
END;
$function$;

-- This helper is only called by the two SECURITY DEFINER matchmaking RPCs.
REVOKE ALL ON FUNCTION public.kuro_unon_matchmaking_try_match(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

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
      AND game_id = p_game_id;

    IF FOUND AND v_room.status = 'waiting' AND v_room.expires_at > now() THEN
      SELECT pg_catalog.count(*)::integer INTO v_live_count
      FROM public.game_online_room_members
      WHERE room_id = v_room.id
        AND last_seen_at >= now() - interval '60 seconds';

      IF v_live_count >= 2 THEN
        UPDATE public.game_online_matchmaking
        SET last_seen_at = now()
        WHERE game_id = p_game_id
          AND user_id = p_user_id;
        RETURN pg_catalog.jsonb_build_object(
          'status', 'matched',
          'room_id', v_room.id
        );
      END IF;

      UPDATE public.game_online_rooms
      SET status = 'closed', player_count = 0
      WHERE id = v_room.id AND game_id = p_game_id;
      DELETE FROM public.game_online_room_members
      WHERE room_id = v_room.id;
    END IF;

    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id
      AND room_id = v_existing.room_id;
  END IF;

  INSERT INTO public.game_online_matchmaking (
    game_id, user_id, status, room_id,
    created_at, last_seen_at, matched_at, match_rule
  ) VALUES (
    p_game_id, p_user_id, 'waiting', NULL,
    now(), now(), NULL, p_rule_mode
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
  WHERE game_id = p_game_id
    AND user_id = p_user_id;

  IF FOUND AND v_existing.status = 'matched' AND v_existing.room_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'matched',
      'room_id', v_existing.room_id
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object('status', 'waiting');
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_unon_matchmaking_status(
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
  v_queue public.game_online_matchmaking;
BEGIN
  IF p_rule_mode NOT IN ('official', 'local') THEN
    RAISE EXCEPTION 'INVALID_MATCH_RULE';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_game_id::text, 0)
  );

  SELECT * INTO v_queue
  FROM public.game_online_matchmaking
  WHERE game_id = p_game_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'cancelled');
  END IF;

  IF v_queue.match_rule <> p_rule_mode THEN
    IF v_queue.status = 'waiting' THEN
      DELETE FROM public.game_online_matchmaking
      WHERE game_id = p_game_id AND user_id = p_user_id;
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'cancelled');
  END IF;

  IF v_queue.status = 'waiting' THEN
    UPDATE public.game_online_matchmaking
    SET last_seen_at = now()
    WHERE game_id = p_game_id AND user_id = p_user_id;

    PERFORM public.kuro_unon_matchmaking_try_match(p_game_id, p_rule_mode);

    SELECT * INTO v_queue
    FROM public.game_online_matchmaking
    WHERE game_id = p_game_id
      AND user_id = p_user_id;

    IF FOUND AND v_queue.status = 'matched' AND v_queue.room_id IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'matched',
        'room_id', v_queue.room_id
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object('status', 'waiting');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'matched',
    'room_id', v_queue.room_id
  );
END;
$function$;
