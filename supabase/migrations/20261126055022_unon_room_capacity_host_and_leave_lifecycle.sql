CREATE OR REPLACE FUNCTION public.kuro_join_online_room(p_game_id uuid, p_room_code text, p_user_id uuid)
RETURNS SETOF public.game_online_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.game_online_rooms;
  v_count integer;
  v_new_host uuid;
BEGIN
  SELECT * INTO v_room
  FROM public.game_online_rooms
  WHERE game_id = p_game_id
    AND room_code = upper(p_room_code)
    AND status = 'waiting'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  -- UNON supports at most four players even though the shared room system
  -- supports larger games. Clamp older oversized UNON rooms on the server.
  IF p_game_id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid THEN
    UPDATE public.game_online_rooms
    SET max_players = LEAST(GREATEST(max_players, 2), 4)
    WHERE id = v_room.id
    RETURNING * INTO v_room;
  END IF;

  DELETE FROM public.game_online_room_members
  WHERE room_id = v_room.id
    AND last_seen_at < now() - interval '30 seconds';

  SELECT count(*)::integer INTO v_count
  FROM public.game_online_room_members
  WHERE room_id = v_room.id;

  -- Repair rooms left with a stale/missing host. The oldest remaining member
  -- takes ownership; when nobody remains, the incoming player becomes host.
  IF v_room.host_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.game_online_room_members
    WHERE room_id = v_room.id
      AND user_id = v_room.host_user_id
  ) THEN
    SELECT user_id INTO v_new_host
    FROM public.game_online_room_members
    WHERE room_id = v_room.id
    ORDER BY joined_at ASC, user_id ASC
    LIMIT 1;

    v_new_host := COALESCE(v_new_host, p_user_id);
    UPDATE public.game_online_rooms
    SET host_user_id = v_new_host,
        player_count = v_count
    WHERE id = v_room.id
    RETURNING * INTO v_room;
  ELSE
    UPDATE public.game_online_rooms
    SET player_count = v_count
    WHERE id = v_room.id
    RETURNING * INTO v_room;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.game_online_room_members
    WHERE room_id = v_room.id
      AND user_id = p_user_id
  ) THEN
    UPDATE public.game_online_room_members
    SET last_seen_at = now()
    WHERE room_id = v_room.id
      AND user_id = p_user_id;

    RETURN NEXT v_room;
    RETURN;
  END IF;

  IF v_count >= v_room.max_players THEN
    RAISE EXCEPTION 'ROOM_FULL';
  END IF;

  INSERT INTO public.game_online_room_members(room_id, user_id)
  VALUES (v_room.id, p_user_id);

  UPDATE public.game_online_rooms
  SET player_count = player_count + 1
  WHERE id = v_room.id
  RETURNING * INTO v_room;

  RETURN NEXT v_room;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_leave_online_room(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_room public.game_online_rooms;
  v_deleted integer;
  v_random_match boolean;
  v_unon_random_match boolean;
  v_remaining integer;
  v_new_host uuid;
BEGIN
  SELECT * INTO v_room
  FROM public.game_online_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.game_online_room_members
    WHERE room_id = p_room_id
      AND user_id = p_user_id
  ) THEN
    RETURN false;
  END IF;

  v_random_match := COALESCE(v_room.game_data->>'kind' = 'sevens-random-match', false);
  v_unon_random_match := v_room.game_id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid
    AND COALESCE(v_room.game_data->>'kind' = 'unon-random-match', false)
    AND v_room.status = 'waiting';

  DELETE FROM public.game_sevens_room_votes
  WHERE room_id = p_room_id
    AND user_id = p_user_id;

  DELETE FROM public.game_online_room_members
  WHERE room_id = p_room_id
    AND user_id = p_user_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN false;
  END IF;

  -- A player who leaves a still-waiting UNON matchmaking lobby must not keep
  -- a matched ticket that sends their next search back to the old room.
  IF v_unon_random_match THEN
    DELETE FROM public.game_online_matchmaking
    WHERE game_id = v_room.game_id
      AND room_id = p_room_id
      AND user_id = p_user_id;

    DELETE FROM public.kuro_any_matchmaking_queue
    WHERE room_id = p_room_id
      AND user_id = p_user_id;
  END IF;

  SELECT count(*)::integer INTO v_remaining
  FROM public.game_online_room_members
  WHERE room_id = p_room_id;

  IF v_remaining = 0 THEN
    UPDATE public.game_online_rooms
    SET status = 'closed',
        player_count = 0
    WHERE id = p_room_id;

    DELETE FROM public.game_online_room_members WHERE room_id = p_room_id;
    DELETE FROM public.game_online_matchmaking WHERE room_id = p_room_id;
    DELETE FROM public.kuro_any_matchmaking_queue WHERE room_id = p_room_id;
    DELETE FROM public.game_sevens_room_votes WHERE room_id = p_room_id;
  ELSIF v_random_match AND v_room.status = 'waiting' THEN
    UPDATE public.game_online_rooms
    SET status = 'closed',
        player_count = 0
    WHERE id = p_room_id;

    DELETE FROM public.game_online_room_members WHERE room_id = p_room_id;
    DELETE FROM public.game_online_matchmaking WHERE room_id = p_room_id;
    DELETE FROM public.kuro_any_matchmaking_queue WHERE room_id = p_room_id;
    DELETE FROM public.game_sevens_room_votes WHERE room_id = p_room_id;
  ELSIF v_room.status = 'waiting' THEN
    DELETE FROM public.game_sevens_room_votes WHERE room_id = p_room_id;

    IF v_room.host_user_id = p_user_id AND v_remaining > 0 THEN
      SELECT user_id INTO v_new_host
      FROM public.game_online_room_members
      WHERE room_id = p_room_id
      ORDER BY joined_at ASC, user_id ASC
      LIMIT 1;

      UPDATE public.game_online_rooms
      SET host_user_id = v_new_host,
          player_count = v_remaining
      WHERE id = p_room_id;
    ELSE
      UPDATE public.game_online_rooms
      SET player_count = v_remaining
      WHERE id = p_room_id;
    END IF;
  ELSE
    UPDATE public.game_online_rooms
    SET player_count = v_remaining
    WHERE id = p_room_id;

    IF v_room.host_user_id = p_user_id AND v_remaining > 0 THEN
      SELECT user_id INTO v_new_host
      FROM public.game_online_room_members
      WHERE room_id = p_room_id
      ORDER BY joined_at ASC, user_id ASC
      LIMIT 1;

      UPDATE public.game_online_rooms
      SET host_user_id = v_new_host
      WHERE id = p_room_id;
    END IF;
  END IF;

  RETURN true;
END;
$function$;