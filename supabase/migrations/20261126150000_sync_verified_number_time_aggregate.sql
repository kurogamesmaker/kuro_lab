-- Keep verified Number Guess time ranking aggregates synchronized even when the
-- unified play-event ledger already deduplicated the submission.
create or replace function public.kuro_submit_verified_number_score(
  p_game_id uuid,
  p_user_id uuid,
  p_mode character varying,
  p_submission_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns table(id uuid, score bigint, score_mode character varying, created_at timestamp with time zone, improved boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session public.game_verification_sessions%rowtype;
  v_row public.game_scores%rowtype;
  v_level text;
  v_expected_range integer;
  v_elapsed bigint;
  v_improved boolean := false;
  v_verified_metadata jsonb;
begin
  if p_game_id is distinct from 'bb466662-5423-48e6-bbcc-d19da50ba818'::uuid then
    raise exception 'INVALID_GAME';
  end if;
  if p_user_id is null or p_submission_id is null then
    raise exception 'INVALID_SUBMISSION';
  end if;

  select s.* into v_session
  from public.game_verification_sessions s
  where s.id = p_submission_id
    and s.game_id = p_game_id
    and s.user_id = p_user_id
    and s.game_type = 'number_guess'
    and s.status = 'completed'
    and s.result = 'correct'
    and s.state->>'playMode' = 'time'
  for update;

  if not found then raise exception 'VERIFIED_SESSION_NOT_FOUND'; end if;

  v_level := lower(coalesce(v_session.state->>'level',''));
  v_expected_range := case v_level
    when 'easy' then 10 when 'normal' then 30 when 'hard' then 100
    when 'expert' then 300 when 'master' then 1000 when 'legend' then 10000
    else null
  end;
  if v_expected_range is null or v_session.range_max <> v_expected_range then
    raise exception 'INVALID_LEVEL';
  end if;
  if p_mode <> ('number-time-' || v_level)::varchar then raise exception 'INVALID_MODE'; end if;

  if coalesce(p_metadata->>'serverVerified','') <> 'number-guess-v1'
    or coalesce(p_metadata->>'source','') <> 'number-guess-server'
    or coalesce(p_metadata->>'metric','') <> 'clear_time_ms'
    or coalesce(p_metadata->>'sessionId','') <> p_submission_id::text
    or coalesce(p_metadata->>'difficulty','') <> v_level
    or coalesce(p_metadata->>'rangeMax','') <> v_session.range_max::text
    or coalesce(p_metadata->>'attempts','') <> v_session.attempts::text then
    raise exception 'INVALID_VERIFICATION_METADATA';
  end if;

  v_elapsed := floor(extract(epoch from (v_session.completed_at - v_session.started_at)) * 1000)::bigint;
  if v_elapsed < 400 or v_elapsed > 3600000 then raise exception 'INVALID_ELAPSED_TIME'; end if;

  v_verified_metadata := p_metadata || jsonb_build_object(
    'metric','clear_time_ms',
    'verifiedRanking','number-guess-v1',
    'serverVerified','number-guess-v1'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_game_id::text || ':' || p_user_id::text || ':' || p_mode || ':verified-number',0)
  );

  select s.* into v_row
  from public.game_scores s
  where s.game_id = p_game_id and s.user_id = p_user_id and s.mode = p_mode
    and s.level is null and s.cpu_difficulty is null
  for update;

  if found then
    if v_row.metadata->>'serverVerified' is distinct from 'number-guess-v1'
      or v_elapsed < v_row.score then
      update public.game_scores as gs
      set score = v_elapsed, submission_id = p_submission_id,
          metadata = v_verified_metadata, created_at = pg_catalog.now()
      where gs.id = v_row.id
      returning gs.* into v_row;
      v_improved := true;
    else
      v_improved := false;
    end if;
  else
    insert into public.game_scores(game_id,user_id,mode,score,submission_id,metadata,level,cpu_difficulty)
    values(p_game_id,p_user_id,p_mode,v_elapsed,p_submission_id,v_verified_metadata,null,null)
    returning * into v_row;
    v_improved := true;
  end if;

  insert into public.kuro_game_user_stats(
    user_id,game_id,mode,plays,wins,losses,draws,best_score,best_time_ms,total_time_ms,
    last_played_at,metadata,updated_at,recent_submission_ids
  ) values (
    p_user_id,p_game_id,p_mode,0,0,0,0,null,v_elapsed,0,pg_catalog.now(),v_verified_metadata,pg_catalog.now(),array[]::uuid[]
  )
  on conflict(user_id,game_id,mode) do update set
    best_time_ms=least(coalesce(public.kuro_game_user_stats.best_time_ms,excluded.best_time_ms),excluded.best_time_ms),
    best_score=null,
    metadata=public.kuro_game_user_stats.metadata || excluded.metadata,
    updated_at=pg_catalog.now();

  update public.game_verification_sessions as vs
  set score_recorded = true, score_recovery_status='recorded'
  where vs.id = p_submission_id and vs.game_id = p_game_id and vs.user_id = p_user_id;

  return query select v_row.id,v_row.score,v_row.mode,v_row.created_at,v_improved;
end;
$function$;
