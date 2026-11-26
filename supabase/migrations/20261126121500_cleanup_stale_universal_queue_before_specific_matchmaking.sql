CREATE OR REPLACE FUNCTION public.kuro_any_matchmaking_specific_run(p_game_id uuid, p_user_id uuid, p_match_rule text, p_operation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
  v_queue public.game_online_matchmaking;
  v_any_queue public.kuro_any_matchmaking_queue;
  v_peer uuid;
  v_created timestamptz;
BEGIN
  IF p_operation NOT IN ('join','status') THEN
    RAISE EXCEPTION 'ANY_MATCH_INVALID_OPERATION';
  END IF;
  IF p_game_id NOT IN (
    'faa155cb-2143-4361-9a96-dc759d334e46'::uuid,
    '2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid,
    '4ccccb72-d5db-4098-a7d4-1c28a0755e7b'::uuid
  ) THEN
    RAISE EXCEPTION 'ANY_MATCH_GAME_NOT_SUPPORTED';
  END IF;
  IF p_game_id='faa155cb-2143-4361-9a96-dc759d334e46'::uuid THEN
    IF p_match_rule NOT IN ('official','local') THEN
      RAISE EXCEPTION 'INVALID_MATCH_RULE';
    END IF;
  ELSIF p_match_rule<>'official' THEN
    RAISE EXCEPTION 'INVALID_MATCH_RULE';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kuro-any-matchmaking-v1',0)
  );

  -- Expire abandoned universal tickets before checking whether the caller is
  -- already searching. This keeps a closed tab from blocking a later game queue.
  DELETE FROM public.game_online_matchmaking q
  USING public.kuro_any_matchmaking_queue a
  WHERE a.user_id=q.user_id
    AND a.game_id=q.game_id
    AND a.status='waiting'
    AND a.last_seen_at < now()-interval '45 seconds'
    AND q.status='waiting';

  DELETE FROM public.kuro_any_matchmaking_queue
  WHERE status='waiting'
    AND last_seen_at < now()-interval '45 seconds';

  SELECT * INTO v_any_queue
  FROM public.kuro_any_matchmaking_queue
  WHERE user_id=p_user_id
  FOR UPDATE;

  IF FOUND AND v_any_queue.status='waiting'
     AND v_any_queue.game_id IS NULL THEN
    RAISE EXCEPTION 'ANY_USER_ALREADY_IN_UNIVERSAL_QUEUE';
  END IF;

  SELECT created_at INTO v_created
  FROM public.game_online_matchmaking
  WHERE game_id=p_game_id
    AND user_id=p_user_id
    AND status='waiting'
    AND match_rule=p_match_rule;

  INSERT INTO public.kuro_any_matchmaking_queue
    (user_id,status,game_id,match_rule,room_id,created_at,last_seen_at,matched_at)
  VALUES
    (p_user_id,'waiting',p_game_id,p_match_rule,NULL,
     coalesce(v_created,now()),now(),NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    status='waiting',
    game_id=EXCLUDED.game_id,
    match_rule=EXCLUDED.match_rule,
    room_id=NULL,
    created_at=CASE
      WHEN public.kuro_any_matchmaking_queue.status='waiting'
       AND public.kuro_any_matchmaking_queue.game_id=EXCLUDED.game_id
       AND public.kuro_any_matchmaking_queue.match_rule=EXCLUDED.match_rule
      THEN public.kuro_any_matchmaking_queue.created_at
      ELSE EXCLUDED.created_at
    END,
    last_seen_at=now(),
    matched_at=NULL;

  v_result := public.kuro_any_matchmaking_dispatch(
    p_game_id,p_user_id,p_match_rule,p_operation
  );

  -- If the game-specific queue was removed by another player's cancellation,
  -- resume this still-open search rather than leaving the UI polling a dead ticket.
  IF coalesce(v_result->>'status','')='cancelled'
     AND p_operation='status' THEN
    v_result := public.kuro_any_matchmaking_dispatch(
      p_game_id,p_user_id,p_match_rule,'join'
    );
  END IF;

  SELECT * INTO v_queue
  FROM public.game_online_matchmaking
  WHERE game_id=p_game_id AND user_id=p_user_id;

  IF FOUND AND v_queue.status='matched' AND v_queue.room_id IS NOT NULL THEN
    UPDATE public.kuro_any_matchmaking_queue
    SET status='matched',game_id=p_game_id,match_rule=p_match_rule,
        room_id=v_queue.room_id,matched_at=coalesce(v_queue.matched_at,now()),
        last_seen_at=now()
    WHERE user_id=p_user_id;
    RETURN pg_catalog.jsonb_build_object(
      'status','matched','room_id',v_queue.room_id
    );
  END IF;

  SELECT a.user_id INTO v_peer
  FROM public.kuro_any_matchmaking_queue a
  WHERE a.user_id<>p_user_id
    AND a.status='waiting'
    AND a.last_seen_at>=now()-interval '25 seconds'
    AND (
      a.game_id IS NULL
      OR (
        a.game_id=p_game_id
        AND a.match_rule=p_match_rule
        AND NOT EXISTS (
          SELECT 1
          FROM public.game_online_matchmaking existing_match
          WHERE existing_match.game_id=p_game_id
            AND existing_match.user_id=a.user_id
            AND existing_match.status='matched'
        )
      )
    )
  ORDER BY a.created_at,a.user_id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_peer IS NOT NULL THEN
    UPDATE public.kuro_any_matchmaking_queue
    SET game_id=p_game_id,match_rule=p_match_rule,last_seen_at=now()
    WHERE user_id=v_peer;

    v_result := public.kuro_any_matchmaking_dispatch(
      p_game_id,v_peer,p_match_rule,'join'
    );

    SELECT * INTO v_queue
    FROM public.game_online_matchmaking
    WHERE game_id=p_game_id AND user_id=p_user_id;

    IF FOUND AND v_queue.status='matched' AND v_queue.room_id IS NOT NULL THEN
      UPDATE public.kuro_any_matchmaking_queue
      SET status='matched',game_id=p_game_id,match_rule=p_match_rule,
          room_id=v_queue.room_id,matched_at=coalesce(v_queue.matched_at,now()),
          last_seen_at=now()
      WHERE user_id=p_user_id OR user_id=v_peer;

      RETURN pg_catalog.jsonb_build_object(
        'status','matched','room_id',v_queue.room_id
      );
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('status','waiting');
END;
$function$
;
