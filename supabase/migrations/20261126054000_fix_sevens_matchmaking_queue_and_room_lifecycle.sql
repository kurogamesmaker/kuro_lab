-- Keep Sevens matchmaking tickets in sync with the shared KURO MATCH queue.
-- The lock order matches kuro_any_matchmaking_specific_run: global queue, then game queue.

CREATE OR REPLACE FUNCTION public.kuro_sevens_matchmaking_cancel(p_game_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_queue public.game_online_matchmaking;
  v_any_queue public.kuro_any_matchmaking_queue;
  v_deleted integer := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kuro-any-matchmaking-v1', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_game_id::text, 7117)
  );

  SELECT * INTO v_queue
  FROM public.game_online_matchmaking
  WHERE game_id = p_game_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- A previous client version could remove the game-specific ticket while
    -- leaving its shared ticket behind. Allow the user to cancel that orphan.
    SELECT * INTO v_any_queue
    FROM public.kuro_any_matchmaking_queue
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF FOUND
       AND v_any_queue.game_id = p_game_id
       AND v_any_queue.status = 'waiting' THEN
      DELETE FROM public.kuro_any_matchmaking_queue
      WHERE user_id = p_user_id
        AND game_id = p_game_id
        AND status = 'waiting';
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF v_queue.match_rule <> 'official' THEN
    RETURN false;
  END IF;

  IF v_queue.status = 'matched' AND v_queue.room_id IS NOT NULL THEN
    UPDATE public.game_online_rooms
    SET status = 'closed', player_count = 0
    WHERE id = v_queue.room_id AND status = 'waiting';

    IF EXISTS (
      SELECT 1 FROM public.game_online_rooms
      WHERE id = v_queue.room_id AND status = 'closed'
    ) THEN
      DELETE FROM public.game_online_room_members
      WHERE room_id = v_queue.room_id;
      DELETE FROM public.game_sevens_room_votes
      WHERE room_id = v_queue.room_id;
    END IF;

    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id AND room_id = v_queue.room_id;
    DELETE FROM public.kuro_any_matchmaking_queue
    WHERE game_id = p_game_id AND room_id = v_queue.room_id;
  ELSE
    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id AND user_id = p_user_id;

    DELETE FROM public.kuro_any_matchmaking_queue
    WHERE user_id = p_user_id
      AND game_id = p_game_id
      AND status = 'waiting';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_sevens_matchmaking_ack(
  p_game_id uuid,
  p_user_id uuid,
  p_room_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_acknowledged boolean := false;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kuro-any-matchmaking-v1', 0)
  );

  -- Never acknowledge a room unless the caller is still a member.
  IF NOT EXISTS (
    SELECT 1
    FROM public.game_online_room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.game_online_matchmaking
  WHERE game_id = p_game_id
    AND user_id = p_user_id
    AND room_id = p_room_id
    AND status = 'matched'
    AND match_rule = 'official';
  v_acknowledged := FOUND;

  -- The room may already have started and removed the specific queue row.
  -- Clear the shared ticket independently so delayed acknowledgements work.
  DELETE FROM public.kuro_any_matchmaking_queue
  WHERE user_id = p_user_id
    AND game_id = p_game_id
    AND room_id = p_room_id
    AND status = 'matched';
  IF FOUND THEN
    v_acknowledged := true;
  END IF;

  RETURN v_acknowledged;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_sevens_game_start(
  p_game_id uuid,
  p_room_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.game_online_rooms;
  v_session public.game_sevens_private_sessions;
  v_order uuid[];
  v_count integer;
  v_votes_ready integer;
  v_votes_start integer;
  v_uid uuid;
  v_target uuid;
  v_deck jsonb;
  v_hands jsonb := '{}'::jsonb;
  v_item jsonb;
  v_ord bigint;
  v_sorted jsonb;
  v_players jsonb := '[]'::jsonb;
  v_name text;
  v_board_row jsonb;
  v_board jsonb;
BEGIN
  SELECT * INTO v_room
  FROM public.game_online_rooms
  WHERE id = p_room_id AND game_id = p_game_id
  FOR UPDATE;

  IF NOT FOUND OR v_room.status = 'closed' THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.game_online_room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'ROOM_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT array_agg(user_id ORDER BY joined_at ASC, user_id ASC), count(*)
  INTO v_order, v_count
  FROM public.game_online_room_members
  WHERE room_id = p_room_id;

  IF v_count < 2 OR v_count > 4 THEN
    RAISE EXCEPTION 'SEVENS_REQUIRES_TWO_TO_FOUR_PLAYERS';
  END IF;

  SELECT count(*) FILTER (WHERE v.ready), count(*) FILTER (WHERE v.start_vote)
  INTO v_votes_ready, v_votes_start
  FROM public.game_online_room_members m
  LEFT JOIN public.game_sevens_room_votes v
    ON v.room_id = m.room_id AND v.user_id = m.user_id
  WHERE m.room_id = p_room_id;

  IF v_votes_ready <> v_count OR v_votes_start <> v_count THEN
    RAISE EXCEPTION 'SEVENS_NOT_ALL_READY';
  END IF;

  SELECT * INTO v_session
  FROM public.game_sevens_private_sessions
  WHERE room_id = p_room_id AND game_id = p_game_id
  FOR UPDATE;

  IF FOUND THEN
    -- Idempotent start also repairs tickets left by older clients.
    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id AND room_id = p_room_id;
    DELETE FROM public.kuro_any_matchmaking_queue
    WHERE game_id = p_game_id AND room_id = p_room_id;
    DELETE FROM public.game_sevens_room_votes
    WHERE room_id = p_room_id;

    RETURN jsonb_build_object(
      'ok', true,
      'publicState', v_session.session_state->'public',
      'hand', coalesce(v_session.session_state->'hands'->p_user_id::text, '[]'::jsonb),
      'version', v_session.version
    );
  END IF;

  SELECT jsonb_agg(card ORDER BY random())
  INTO v_deck
  FROM (
    SELECT jsonb_build_object('s', s, 'r', r) AS card
    FROM generate_series(0, 3) s
    CROSS JOIN generate_series(1, 13) r
    WHERE r <> 7
  ) d;

  FOREACH v_uid IN ARRAY v_order LOOP
    v_hands := jsonb_set(v_hands, ARRAY[v_uid::text], '[]'::jsonb, true);
  END LOOP;

  FOR v_item, v_ord IN
    SELECT value, ordinality
    FROM jsonb_array_elements(v_deck) WITH ORDINALITY
  LOOP
    v_target := v_order[((v_ord - 1)::integer % v_count) + 1];
    v_hands := jsonb_set(
      v_hands,
      ARRAY[v_target::text],
      coalesce(v_hands->v_target::text, '[]'::jsonb) || jsonb_build_array(v_item),
      true
    );
  END LOOP;

  FOREACH v_uid IN ARRAY v_order LOOP
    SELECT coalesce(
      jsonb_agg(card ORDER BY (card->>'s')::integer, (card->>'r')::integer),
      '[]'::jsonb
    )
    INTO v_sorted
    FROM jsonb_array_elements(v_hands->v_uid::text) AS item(card);

    v_hands := jsonb_set(v_hands, ARRAY[v_uid::text], v_sorted, true);

    SELECT coalesce(nullif(btrim(p.username), ''), 'プレイヤー')
    INTO v_name
    FROM public.profiles p
    WHERE p.id = v_uid;
    v_name := coalesce(v_name, 'プレイヤー');

    v_players := v_players || jsonb_build_array(jsonb_build_object(
      'userId', v_uid,
      'displayName', v_name,
      'cardCount', 48 / v_count,
      'passes', 0,
      'status', 'playing',
      'streak', 0,
      'played', 0
    ));
  END LOOP;

  SELECT jsonb_agg(
    CASE WHEN i = 7 THEN 'true'::jsonb ELSE 'false'::jsonb END
    ORDER BY i
  )
  INTO v_board_row
  FROM generate_series(0, 14) g(i);

  v_board := jsonb_build_array(v_board_row, v_board_row, v_board_row, v_board_row);

  INSERT INTO public.game_sevens_private_sessions(
    room_id, game_id, session_state, version, updated_at
  )
  VALUES (
    p_room_id,
    p_game_id,
    jsonb_build_object(
      'hands', v_hands,
      'public', jsonb_build_object(
        'phase', 'playing',
        'board', v_board,
        'players', v_players,
        'currentUserId', v_order[1],
        'finishUserIds', '[]'::jsonb,
        'bustUserIds', '[]'::jsonb,
        'rankingUserIds', '[]'::jsonb,
        'over', false,
        'last', null,
        'fresh', null,
        'bump', null,
        'msg', '7はすべて場に出ています。対戦スタート！'
      )
    ),
    1,
    now()
  )
  RETURNING * INTO v_session;

  UPDATE public.game_online_rooms
  SET status = 'playing', game_data_updated_at = now()
  WHERE id = p_room_id;

  -- A live game no longer needs either matchmaking ticket or lobby votes.
  DELETE FROM public.game_online_matchmaking
  WHERE game_id = p_game_id AND room_id = p_room_id;
  DELETE FROM public.kuro_any_matchmaking_queue
  WHERE game_id = p_game_id AND room_id = p_room_id;
  DELETE FROM public.game_sevens_room_votes
  WHERE room_id = p_room_id;

  RETURN jsonb_build_object(
    'ok', true,
    'publicState', v_session.session_state->'public',
    'hand', coalesce(v_session.session_state->'hands'->p_user_id::text, '[]'::jsonb),
    'version', v_session.version
  );
END;
$function$;
