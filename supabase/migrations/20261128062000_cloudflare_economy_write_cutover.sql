-- Move XP and KC award execution from Supabase triggers to Cloudflare D1.
-- Supabase remains the identity provider and emits compact verified award events.
-- D1 is the only post-cutover writer for balances, XP, their ledgers and reward notices.

CREATE TABLE IF NOT EXISTS public.kuro_economy_pending_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('xp_win','coin_verified_game','coin_verified_win','coin_werewolf')),
  source_table text NOT NULL,
  source_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id uuid,
  mode text,
  submission_id uuid,
  cpu_difficulty text,
  verified_score integer,
  result text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT kuro_economy_pending_events_source_uq UNIQUE (event_type, source_table, source_id)
);

ALTER TABLE public.kuro_economy_pending_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kuro_economy_pending_events FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS kuro_economy_pending_events_created_idx
  ON public.kuro_economy_pending_events(created_at);

DROP TRIGGER IF EXISTS kuro_cloudflare_mirror_capture ON public.kuro_economy_pending_events;
CREATE TRIGGER kuro_cloudflare_mirror_capture
  AFTER INSERT OR UPDATE OR DELETE ON public.kuro_economy_pending_events
  FOR EACH ROW EXECUTE FUNCTION public.kuro_cloudflare_capture_row_change();

CREATE OR REPLACE FUNCTION public.kuro_economy_capture_coin_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row jsonb;
  v_source_id text;
BEGIN
  v_row := pg_catalog.to_jsonb(NEW);
  v_source_id := v_row ->> 'id';
  IF v_source_id IS NULL OR v_row ->> 'user_id' IS NULL THEN
    RAISE EXCEPTION 'KURO_ECONOMY_EVENT_MISSING_IDENTITY';
  END IF;

  INSERT INTO public.kuro_economy_pending_events (
    event_type, source_table, source_id, user_id, game_id, mode,
    submission_id, cpu_difficulty, verified_score, created_at
  )
  VALUES (
    TG_ARGV[0],
    TG_TABLE_NAME,
    v_source_id,
    (v_row ->> 'user_id')::uuid,
    NULLIF(v_row ->> 'game_id','')::uuid,
    NULLIF(v_row ->> 'mode',''),
    NULLIF(v_row ->> 'submission_id','')::uuid,
    NULLIF(v_row ->> 'cpu_difficulty',''),
    COALESCE(NULLIF(v_row ->> 'verified_score','')::integer, NULLIF(v_row ->> 'score','')::integer),
    COALESCE(NULLIF(v_row ->> 'created_at','')::timestamptz, pg_catalog.now())
  )
  ON CONFLICT (event_type, source_table, source_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.kuro_economy_capture_coin_event() FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.kuro_economy_pending_events TO service_role;

DROP TRIGGER IF EXISTS kuro_coin_reward_from_verified_game_event ON public.kuro_coin_verified_game_events;
CREATE TRIGGER kuro_economy_capture_verified_game_event
  AFTER INSERT ON public.kuro_coin_verified_game_events
  FOR EACH ROW
  WHEN (
    (
      NEW.game_id IN (
        'faa155cb-2143-4361-9a96-dc759d334e46'::uuid,
        '2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid
      )
      AND NEW.mode = 'wins-online'
    )
    OR (
      NEW.game_id = '4ccccb72-d5db-4098-a7d4-1c28a0755e7b'::uuid
      AND NEW.mode = 'online'
    )
    OR (
      NEW.game_id = '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid
      AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')
    )
  )
    AND pg_catalog.upper(COALESCE(NEW.cpu_difficulty,'NONE')) = 'NONE'
  )
  EXECUTE FUNCTION public.kuro_economy_capture_coin_event('coin_verified_game');

DROP TRIGGER IF EXISTS kuro_coin_reward_from_verified_win ON public.kuro_game_win_events;
CREATE TRIGGER kuro_economy_capture_verified_win
  AFTER INSERT ON public.kuro_game_win_events
  FOR EACH ROW
  WHEN (
    (
      NEW.game_id IN (
        'faa155cb-2143-4361-9a96-dc759d334e46'::uuid,
        '2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid
      )
      AND NEW.mode = 'wins-online'
    )
    OR (
      NEW.game_id = '4ccccb72-d5db-4098-a7d4-1c28a0755e7b'::uuid
      AND NEW.mode = 'online'
    )
    OR (
      NEW.game_id = '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid
      AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')
    )
  )
    AND pg_catalog.upper(COALESCE(NEW.cpu_difficulty,'NONE')) = 'NONE'
  )
  EXECUTE FUNCTION public.kuro_economy_capture_coin_event('coin_verified_win');

DROP TRIGGER IF EXISTS kuro_coin_reward_from_verified_werewolf_score ON public.game_scores;
CREATE TRIGGER kuro_economy_capture_werewolf_win
  AFTER INSERT ON public.game_scores
  FOR EACH ROW
  WHEN (
    NEW.game_id = '903a4c45-37bb-4a4b-a259-a5a8245de998'::uuid
    AND NEW.mode IN ('werewolf_villager_wins','werewolf_wolf_wins')
    AND NEW.score = 1
    AND NEW.metadata ->> 'source' = 'server-validated-werewolf'
  )
  EXECUTE FUNCTION public.kuro_economy_capture_coin_event('coin_werewolf');

-- The existing TTT trigger never had an enabled KC reward configuration. Remove
-- its direct Supabase writer so no economy mutation can bypass the D1 processor.
DROP TRIGGER IF EXISTS kuro_coin_reward_from_tictactoe ON public.game_tictactoe_verified_events;

DROP TRIGGER IF EXISTS kuro_level_users_coin_milestone_reward ON public.kuro_level_users;
DROP TRIGGER IF EXISTS kuro_level_users_notify_level_up ON public.kuro_level_users;
DROP TRIGGER IF EXISTS kuro_coin_notify_reward_trigger ON public.kuro_coin_ledger;

CREATE OR REPLACE FUNCTION public.kuro_record_user_game_event(
  p_submission_id uuid,
  p_user_id uuid,
  p_game_id uuid,
  p_mode text,
  p_result text DEFAULT 'played'::text,
  p_score bigint DEFAULT NULL::bigint,
  p_duration_ms bigint DEFAULT NULL::bigint,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  v_mode text := btrim(coalesce(p_mode,''));
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_is_time boolean;
  v_best_score bigint;
  v_best_time bigint;
  v_recorded_user_id uuid;
begin
  if p_submission_id is null or p_user_id is null or p_game_id is null then
    raise exception 'INVALID_GAME_EVENT_ID';
  end if;
  if v_mode !~ '^[A-Za-z0-9_-]{1,40}$' then
    raise exception 'INVALID_GAME_EVENT_MODE';
  end if;
  if p_result not in ('win','loss','draw','played','abandoned','invalid') then
    raise exception 'INVALID_GAME_EVENT_RESULT';
  end if;
  if jsonb_typeof(v_meta) <> 'object' or pg_column_size(v_meta) > 8192 then
    raise exception 'INVALID_GAME_EVENT_METADATA';
  end if;
  if p_duration_ms is not null and p_duration_ms < 0 then
    raise exception 'INVALID_GAME_EVENT_DURATION';
  end if;

  if exists (
    select 1 from public.kuro_game_play_events e
    where e.user_id=p_user_id and e.game_id=p_game_id
      and e.mode=v_mode and e.submission_id=p_submission_id
  ) then
    return false;
  end if;

  v_is_time :=
    v_mode ~* '(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)'
    or coalesce(v_meta->>'metric','') in ('clear_time_ms','time_ms','duration_ms');

  v_best_score := case
    when p_score is not null and not v_is_time
      and coalesce(v_meta->>'metric','') <> 'wins'
    then p_score else null end;
  v_best_time := case
    when v_is_time then coalesce(p_duration_ms,p_score)
    else null end;

  insert into public.kuro_game_user_stats(
    user_id,game_id,mode,plays,wins,losses,draws,
    best_score,best_time_ms,total_time_ms,last_played_at,
    metadata,updated_at,recent_submission_ids
  ) values (
    p_user_id,p_game_id,v_mode,1,
    case when p_result='win' then 1 else 0 end,
    case when p_result='loss' then 1 else 0 end,
    case when p_result='draw' then 1 else 0 end,
    v_best_score,v_best_time,coalesce(p_duration_ms,0),pg_catalog.now(),
    v_meta,pg_catalog.now(),array[p_submission_id]::uuid[]
  )
  on conflict(user_id,game_id,mode) do update set
    plays=public.kuro_game_user_stats.plays+1,
    wins=public.kuro_game_user_stats.wins+case when p_result='win' then 1 else 0 end,
    losses=public.kuro_game_user_stats.losses+case when p_result='loss' then 1 else 0 end,
    draws=public.kuro_game_user_stats.draws+case when p_result='draw' then 1 else 0 end,
    best_score=case
      when excluded.best_score is null then public.kuro_game_user_stats.best_score
      when public.kuro_game_user_stats.best_score is null then excluded.best_score
      else greatest(public.kuro_game_user_stats.best_score,excluded.best_score)
    end,
    best_time_ms=case
      when excluded.best_time_ms is null then public.kuro_game_user_stats.best_time_ms
      when public.kuro_game_user_stats.best_time_ms is null then excluded.best_time_ms
      else least(public.kuro_game_user_stats.best_time_ms,excluded.best_time_ms)
    end,
    total_time_ms=public.kuro_game_user_stats.total_time_ms+coalesce(p_duration_ms,0),
    last_played_at=pg_catalog.now(),
    metadata=public.kuro_game_user_stats.metadata||v_meta,
    updated_at=pg_catalog.now(),
    recent_submission_ids=case
      when cardinality(public.kuro_game_user_stats.recent_submission_ids)>=32
      then pg_catalog.array_cat(
        public.kuro_game_user_stats.recent_submission_ids[2:32],
        array[p_submission_id]::uuid[]
      )
      else pg_catalog.array_append(public.kuro_game_user_stats.recent_submission_ids,p_submission_id)
    end
  where not (p_submission_id=any(public.kuro_game_user_stats.recent_submission_ids))
  returning user_id into v_recorded_user_id;

  IF v_recorded_user_id IS NOT NULL AND p_result='win' THEN
    INSERT INTO public.kuro_economy_pending_events (
      event_type, source_table, source_id, user_id, game_id, mode,
      submission_id, result, created_at
    )
    VALUES (
      'xp_win', 'kuro_game_user_stats', p_submission_id::text, v_recorded_user_id,
      p_game_id, v_mode, p_submission_id, p_result, pg_catalog.now()
    )
    ON CONFLICT (event_type, source_table, source_id) DO NOTHING;
  END IF;

  return v_recorded_user_id is not null;
end;
$function$;

COMMENT ON TABLE public.kuro_economy_pending_events IS
  'Compact verified XP/KC award events mirrored to Cloudflare D1; D1 processes them idempotently.';

