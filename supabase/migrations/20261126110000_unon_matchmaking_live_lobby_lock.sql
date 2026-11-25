-- Allow late joiners to fill an existing UNON random-match lobby up to 4 players.
CREATE OR REPLACE FUNCTION public.kuro_unon_matchmaking_try_match(p_game_id uuid, p_rule_mode text)
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

  -- First, add newcomers to an already matched UNON random lobby that has not started.
  -- This keeps the matchmaking lobby open for up to four players even if two users
  -- were matched before the next player entered the queue.
  SELECT r.id, r.player_count, r.max_players
  INTO v_room_id, v_player_count, v_attempt
  FROM public.game_online_rooms AS r
  WHERE r.game_id = p_game_id
    AND r.status = 'waiting'
    AND r.expires_at > now()
    AND r.game_data ->> 'kind' = 'unon-random-match'
    AND r.game_data ->> 'ruleMode' = p_rule_mode
    AND r.player_count < r.max_players
    -- Ignore abandoned rooms with no recent heartbeat, and prefer the fullest live lobby.
    AND EXISTS (
      SELECT 1
      FROM public.game_online_room_members AS live_member
      WHERE live_member.room_id = r.id
        AND live_member.last_seen_at >= now() - interval '30 seconds'
    )
  ORDER BY (
    SELECT pg_catalog.count(*)
    FROM public.game_online_room_members AS live_member
    WHERE live_member.room_id = r.id
      AND live_member.last_seen_at >= now() - interval '30 seconds'
  ) DESC, r.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_room_id IS NOT NULL THEN
    SELECT pg_catalog.count(*)::integer INTO v_player_count
    FROM public.game_online_room_members
    WHERE room_id = v_room_id;

    SELECT r.max_players - v_player_count INTO v_attempt
    FROM public.game_online_rooms r WHERE r.id = v_room_id;

    IF v_attempt > 0 THEN
      FOR v_user_id IN
        SELECT q.user_id
        FROM public.game_online_matchmaking q
        WHERE q.game_id = p_game_id
          AND q.status = 'waiting'
          AND q.match_rule = p_rule_mode
          AND q.last_seen_at >= now() - interval '20 seconds'
        ORDER BY q.created_at, q.user_id
        LIMIT v_attempt
        FOR UPDATE SKIP LOCKED
      LOOP
        INSERT INTO public.game_online_room_members(room_id,user_id,last_seen_at)
        VALUES(v_room_id,v_user_id,now())
        ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at;

        UPDATE public.game_online_matchmaking
        SET status='matched', room_id=v_room_id, matched_at=now(), last_seen_at=now()
        WHERE game_id=p_game_id AND user_id=v_user_id AND status='waiting';

        UPDATE public.game_online_rooms
        SET player_count=(SELECT count(*)::smallint FROM public.game_online_room_members WHERE room_id=v_room_id)
        WHERE id=v_room_id;
      END LOOP;
    END IF;

    SELECT r.player_count, r.max_players INTO v_player_count, v_attempt
    FROM public.game_online_rooms r WHERE r.id=v_room_id;
    -- Return to the late-joining caller even if the lobby is not full yet.
    IF v_oldest_created_at IS NOT NULL THEN
      RETURN v_room_id;
    END IF;
    IF v_player_count >= v_attempt THEN
      RETURN v_room_id;
    END IF;
  END IF;

  -- At least two players are required. Four players fill the room immediately.
  IF v_player_count < 2 THEN
    RETURN NULL;
  END IF;

  -- Keep the group open for 15 seconds after the first player joined.
  -- A third/fourth player arriving during this window joins the same group.
  -- If only two or three are available at timeout, match that group as-is.
  IF v_player_count < 4
     AND v_oldest_created_at > now() - interval '15 seconds' THEN
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
