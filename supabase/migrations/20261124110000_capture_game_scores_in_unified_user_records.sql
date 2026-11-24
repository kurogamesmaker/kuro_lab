-- Capture score rows from dedicated game RPCs in the central user record ledger.
-- ranking.submit() uses the same helper in the Edge Function; deduplication keeps this safe.
create or replace function public.kuro_sync_game_score_to_user_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_duration bigint;
begin
  if new.submission_id is null then return new; end if;
  if coalesce(v_metadata->>'source','') like 'tictactoe%' then return new; end if;

  if tg_op = 'UPDATE' then
    if new.submission_id is not distinct from old.submission_id then
      return new;
    end if;
  end if;

  v_duration := case
    when coalesce(v_metadata->>'durationMs',v_metadata->>'duration_ms') ~ '^[0-9]{1,15}$'
    then (coalesce(v_metadata->>'durationMs',v_metadata->>'duration_ms'))::bigint
    else null
  end;

  perform public.kuro_record_user_game_event(
    new.submission_id,new.user_id,new.game_id,new.mode,
    case when coalesce(v_metadata->>'metric','')='wins' then 'win' else 'played' end,
    new.score,v_duration,
    v_metadata || pg_catalog.jsonb_build_object('unifiedRecordSource','game_scores-trigger')
  );
  return new;
end;
$function$;

revoke all on function public.kuro_sync_game_score_to_user_records() from public, anon, authenticated;

drop trigger if exists kuro_game_scores_user_records on public.game_scores;
create trigger kuro_game_scores_user_records
after insert or update on public.game_scores
for each row execute function public.kuro_sync_game_score_to_user_records();

-- Tic-tac-toe is a wins-based leaderboard; do not store its "1" win marker
-- in the generic high-score field.
create or replace function public.kuro_sync_tictactoe_event_to_user_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.kuro_record_user_game_event(
    new.submission_id,new.user_id,new.game_id,new.rule,new.result,
    case when new.result='win' then 1 else null end,null,
    pg_catalog.jsonb_build_object(
      'metric','wins',
      'source','tictactoe-server','serverVerified',true,
      'rule',new.rule,'cpuDifficulty',new.cpu_difficulty
    )
  );
  return new;
end;
$function$;

update public.kuro_game_play_events
set metadata = metadata || '{"metric":"wins"}'::jsonb
where game_id='2dbd6773-2684-4f00-973e-c46acbc348e7'::uuid
  and metadata->>'source'='tictactoe-server';

update public.kuro_game_user_stats
set best_score=null,
    metadata=metadata || '{"metric":"wins"}'::jsonb,
    updated_at=now()
where game_id='2dbd6773-2684-4f00-973e-c46acbc348e7'::uuid;
