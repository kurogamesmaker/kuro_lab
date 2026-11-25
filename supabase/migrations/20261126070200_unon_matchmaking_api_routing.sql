-- Keep UNON matchmaking cancellation and acknowledgement separate from Daifugo.
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
BEGIN
  IF p_game_id <> 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid THEN
    RAISE EXCEPTION 'INVALID_MATCH_GAME';
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
    RETURN false;
  END IF;

  IF v_queue.status = 'matched' AND v_queue.room_id IS NOT NULL THEN
    UPDATE public.game_online_rooms
    SET status = 'closed', player_count = 0
    WHERE id = v_queue.room_id
      AND game_id = p_game_id
      AND status <> 'closed';

    DELETE FROM public.game_online_room_members
    WHERE room_id = v_queue.room_id;

    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id
      AND room_id = v_queue.room_id;
  ELSE
    DELETE FROM public.game_online_matchmaking
    WHERE game_id = p_game_id
      AND user_id = p_user_id;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kuro_unon_matchmaking_ack(
  p_game_id uuid,
  p_user_id uuid,
  p_room_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF p_game_id <> 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid THEN
    RAISE EXCEPTION 'INVALID_MATCH_GAME';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_game_id::text, 0)
  );

  DELETE FROM public.game_online_matchmaking
  WHERE game_id = p_game_id
    AND user_id = p_user_id
    AND room_id = p_room_id
    AND status = 'matched';

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_unon_matchmaking_cancel(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kuro_unon_matchmaking_ack(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kuro_unon_matchmaking_cancel(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.kuro_unon_matchmaking_ack(uuid, uuid, uuid)
  TO service_role;

-- Make the random-match UI state the actual four-player requirement.
UPDATE public.game_studio_games
SET html_content = replace(html_content, '2人以上でマッチします', '4人揃うとマッチします'),
    updated_at = now()
WHERE id = 'faa155cb-2143-4361-9a96-dc759d334e46'::uuid
  AND html_content LIKE '%2人以上でマッチします%';
