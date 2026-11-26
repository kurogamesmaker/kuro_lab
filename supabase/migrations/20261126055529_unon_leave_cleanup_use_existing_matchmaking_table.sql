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
  IF NOT FOUND THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.game_online_room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
  ) THEN RETURN false; END IF;

  v_random_match := COALESCE(v_room.game_data->>'kind' = 'sevens-random-match', false);
  v_unon_random_match := v_room.game_id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid
    AND COALESCE(v_room.game_data->>'kind' = 'unon-random-match', false)
    AND v_room.status = 'waiting';

  DELETE FROM public.game_sevens_room_votes WHERE room_id = p_room_id AND user_id = p_user_id;
  DELETE FROM public.game_online_room_members WHERE room_id = p_room_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN RETURN false; END IF;

  IF v_unon_random_match THEN
    DELETE FROM public.game_online_matchmaking
    WHERE game_id = v_room.game_id AND room_id = p_room_id AND user_id = p_user_id;
  END IF;

  SELECT count(*)::integer INTO v_remaining
  FROM public.game_online_room_members WHERE room_id = p_room_id;

  IF v_remaining = 0 THEN
    UPDATE public.game_online_rooms SET status = 'closed', player_count = 0 WHERE id = p_room_id;
    DELETE FROM public.game_online_room_members WHERE room_id = p_room_id;
    DELETE FROM public.game_online_matchmaking WHERE room_id = p_room_id;
    DELETE FROM public.game_sevens_room_votes WHERE room_id = p_room_id;
  ELSIF v_random_match AND v_room.status = 'waiting' THEN
    UPDATE public.game_online_rooms SET status = 'closed', player_count = 0 WHERE id = p_room_id;
    DELETE FROM public.game_online_room_members WHERE room_id = p_room_id;
    DELETE FROM public.game_online_matchmaking WHERE room_id = p_room_id;
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
      SET host_user_id = v_new_host, player_count = v_remaining
      WHERE id = p_room_id;
    ELSE
      UPDATE public.game_online_rooms SET player_count = v_remaining WHERE id = p_room_id;
    END IF;
  ELSE
    UPDATE public.game_online_rooms SET player_count = v_remaining WHERE id = p_room_id;
    IF v_room.host_user_id = p_user_id AND v_remaining > 0 THEN
      SELECT user_id INTO v_new_host
      FROM public.game_online_room_members
      WHERE room_id = p_room_id
      ORDER BY joined_at ASC, user_id ASC
      LIMIT 1;
      UPDATE public.game_online_rooms SET host_user_id = v_new_host WHERE id = p_room_id;
    END IF;
  END IF;
  RETURN true;
END;
$function$;