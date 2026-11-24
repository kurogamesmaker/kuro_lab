-- Keep one aggregate row per user/game/mode. Store only a bounded idempotency
-- window in that row; do not append one shared play-event row per completed game.
alter table public.kuro_game_user_stats
  add column if not exists recent_submission_ids uuid[] not null default '{}'::uuid[];

comment on column public.kuro_game_user_stats.recent_submission_ids is
  'Internal bounded deduplication cache: the latest 32 accepted submission IDs. Not a play history.';

create or replace function public.kuro_record_user_game_event(
  p_submission_id uuid,
  p_user_id uuid,
  p_game_id uuid,
  p_mode text,
  p_result text default 'played',
  p_score bigint default null,
  p_duration_ms bigint default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $function$
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

  -- Preserve idempotency for every submission already present in the legacy
  -- event archive, without writing any new rows to that table.
  if exists (
    select 1
    from public.kuro_game_play_events e
    where e.user_id = p_user_id
      and e.game_id = p_game_id
      and e.mode = v_mode
      and e.submission_id = p_submission_id
  ) then
    return false;
  end if;

  v_is_time :=
    v_mode ~* '(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)'
    or coalesce(v_meta->>'metric','') in ('clear_time_ms','time_ms','duration_ms');

  v_best_score := case
    when p_score is not null
      and not v_is_time
      and coalesce(v_meta->>'metric','') <> 'wins'
    then p_score
    else null
  end;
  v_best_time := case
    when v_is_time then coalesce(p_duration_ms,p_score)
    else null
  end;

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
  on conflict (user_id,game_id,mode) do update set
    plays = public.kuro_game_user_stats.plays + 1,
    wins = public.kuro_game_user_stats.wins + case when p_result='win' then 1 else 0 end,
    losses = public.kuro_game_user_stats.losses + case when p_result='loss' then 1 else 0 end,
    draws = public.kuro_game_user_stats.draws + case when p_result='draw' then 1 else 0 end,
    best_score = case
      when excluded.best_score is null then public.kuro_game_user_stats.best_score
      when public.kuro_game_user_stats.best_score is null then excluded.best_score
      else greatest(public.kuro_game_user_stats.best_score,excluded.best_score)
    end,
    best_time_ms = case
      when excluded.best_time_ms is null then public.kuro_game_user_stats.best_time_ms
      when public.kuro_game_user_stats.best_time_ms is null then excluded.best_time_ms
      else least(public.kuro_game_user_stats.best_time_ms,excluded.best_time_ms)
    end,
    total_time_ms = public.kuro_game_user_stats.total_time_ms + coalesce(p_duration_ms,0),
    last_played_at = pg_catalog.now(),
    metadata = public.kuro_game_user_stats.metadata || v_meta,
    updated_at = pg_catalog.now(),
    recent_submission_ids = case
      when cardinality(public.kuro_game_user_stats.recent_submission_ids) >= 32
      then pg_catalog.array_cat(
        public.kuro_game_user_stats.recent_submission_ids[2:32],
        array[p_submission_id]::uuid[]
      )
      else pg_catalog.array_append(
        public.kuro_game_user_stats.recent_submission_ids,
        p_submission_id
      )
    end
  where not (
    p_submission_id = any(public.kuro_game_user_stats.recent_submission_ids)
  )
  returning user_id into v_recorded_user_id;

  return v_recorded_user_id is not null;
end;
$function$;

revoke all on function public.kuro_record_user_game_event(uuid,uuid,uuid,text,text,bigint,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.kuro_record_user_game_event(uuid,uuid,uuid,text,text,bigint,bigint,jsonb)
  to service_role;
