-- UNON random matchmaking must wait for exactly four compatible players.
-- Previously, a ten-second fallback created two- or three-player matches.
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
    pg_catalog.count(*)::integer
  INTO v_user_ids, v_player_count
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

  -- Do not finalize a random match until all four seats are filled.
  IF v_player_count < 4 THEN
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

-- Keep this helper private; the public join/status RPCs invoke it internally.
REVOKE ALL ON FUNCTION public.kuro_unon_matchmaking_try_match(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
