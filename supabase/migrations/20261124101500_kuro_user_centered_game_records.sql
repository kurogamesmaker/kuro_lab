-- KUROGames user-centred game records.
-- User is the owning axis; game_id + mode remain independent ranking dimensions.
-- Migration is safe to re-run: triggers are replaced, rows are deduplicated by submission id.

create table if not exists public.kuro_game_user_stats (
  user_id uuid not null,
  game_id uuid not null,
  mode text not null default 'default',
  plays bigint not null default 0 check (plays >= 0),
  wins bigint not null default 0 check (wins >= 0),
  losses bigint not null default 0 check (losses >= 0),
  draws bigint not null default 0 check (draws >= 0),
  best_score bigint,
  best_time_ms bigint,
  total_time_ms bigint not null default 0 check (total_time_ms >= 0),
  last_played_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id, mode)
);

create table if not exists public.kuro_game_play_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  user_id uuid not null,
  game_id uuid not null,
  mode text not null default 'default',
  result text not null default 'played'
    check (result in ('win','loss','draw','played','abandoned','invalid')),
  score bigint,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, game_id, mode, submission_id)
);

create index if not exists kuro_game_user_stats_game_mode_idx
  on public.kuro_game_user_stats (game_id, mode);
create index if not exists kuro_game_user_stats_user_idx
  on public.kuro_game_user_stats (user_id);
create index if not exists kuro_game_play_events_user_time_idx
  on public.kuro_game_play_events (user_id, created_at desc);
create index if not exists kuro_game_play_events_game_mode_time_idx
  on public.kuro_game_play_events (game_id, mode, created_at desc);
create index if not exists kuro_game_user_stats_rank_score_idx
  on public.kuro_game_user_stats (game_id, mode, best_score desc)
  where best_score is not null;
create index if not exists kuro_game_user_stats_rank_time_idx
  on public.kuro_game_user_stats (game_id, mode, best_time_ms asc)
  where best_time_ms is not null;

-- Unified record payloads (including metadata) are private to the owner.
-- Public rankings continue to be served through the validated Edge Function.
alter table public.kuro_game_user_stats enable row level security;
alter table public.kuro_game_play_events enable row level security;

drop policy if exists kuro_game_user_stats_public_read on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_insert_own on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_update_own on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_read_own on public.kuro_game_user_stats;
create policy kuro_game_user_stats_read_own
  on public.kuro_game_user_stats
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists kuro_game_play_events_read_own on public.kuro_game_play_events;
drop policy if exists kuro_game_play_events_insert_own on public.kuro_game_play_events;
create policy kuro_game_play_events_read_own
  on public.kuro_game_play_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.kuro_game_user_stats from public, anon, authenticated;
revoke all on table public.kuro_game_play_events from public, anon, authenticated;
grant select on table public.kuro_game_user_stats to authenticated;
grant select on table public.kuro_game_play_events to authenticated;
grant select, insert, update, delete on table public.kuro_game_user_stats to service_role;
grant select, insert, update, delete on table public.kuro_game_play_events to service_role;

create or replace function public.kuro_record_user_game_event(
  p_submission_id uuid,
  p_user_id uuid,
  p_game_id uuid,
  p_mode text,
  p_result text default 'played',
  p_score bigint default null,
  p_duration_ms bigint default null,
  p_metadata jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event_id uuid;
  v_mode text := btrim(coalesce(p_mode, ''));
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_is_time boolean;
  v_best_score bigint;
  v_best_time bigint;
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

  v_is_time := v_mode ~* '(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)'
    or coalesce(v_meta->>'metric','') in ('clear_time_ms','time_ms','duration_ms');
  v_best_score := case
    when p_score is not null and not v_is_time
      and coalesce(v_meta->>'metric','') <> 'wins'
    then p_score else null end;
  v_best_time := case when v_is_time then coalesce(p_duration_ms,p_score) else null end;

  insert into public.kuro_game_play_events(
    submission_id,user_id,game_id,mode,result,score,duration_ms,metadata
  ) values (
    p_submission_id,p_user_id,p_game_id,v_mode,p_result,p_score,p_duration_ms,v_meta
  )
  on conflict (user_id,game_id,mode,submission_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then return false; end if;

  insert into public.kuro_game_user_stats(
    user_id,game_id,mode,plays,wins,losses,draws,
    best_score,best_time_ms,total_time_ms,last_played_at,metadata,updated_at
  ) values (
    p_user_id,p_game_id,v_mode,1,
    case when p_result='win' then 1 else 0 end,
    case when p_result='loss' then 1 else 0 end,
    case when p_result='draw' then 1 else 0 end,
    v_best_score,v_best_time,coalesce(p_duration_ms,0),pg_catalog.now(),v_meta,pg_catalog.now()
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
    updated_at = pg_catalog.now();

  return true;
end;
$function$;

revoke all on function public.kuro_record_user_game_event(uuid,uuid,uuid,text,text,bigint,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.kuro_record_user_game_event(uuid,uuid,uuid,text,text,bigint,bigint,jsonb)
  to service_role;

create or replace function public.kuro_sync_win_event_to_user_records()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  perform public.kuro_record_user_game_event(
    new.submission_id,new.user_id,new.game_id,new.mode,'win',1,null,
    pg_catalog.jsonb_build_object(
      'metric','wins','source','win-event',
      'level',new.level,'cpuDifficulty',new.cpu_difficulty
    )
  );
  return new;
end;
$function$;

drop trigger if exists kuro_win_event_user_records on public.kuro_game_win_events;
create trigger kuro_win_event_user_records
after insert on public.kuro_game_win_events
for each row execute function public.kuro_sync_win_event_to_user_records();

create or replace function public.kuro_sync_tictactoe_event_to_user_records()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  perform public.kuro_record_user_game_event(
    new.submission_id,new.user_id,new.game_id,new.rule,new.result,
    case when new.result='win' then 1 else null end,null,
    pg_catalog.jsonb_build_object(
      'source','tictactoe-server','serverVerified',true,
      'rule',new.rule,'cpuDifficulty',new.cpu_difficulty
    )
  );
  return new;
end;
$function$;

drop trigger if exists kuro_tictactoe_event_user_records on public.game_tictactoe_verified_events;
create trigger kuro_tictactoe_event_user_records
after insert on public.game_tictactoe_verified_events
for each row execute function public.kuro_sync_tictactoe_event_to_user_records();

create or replace function public.kuro_sync_sevens_result_to_user_records()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  perform public.kuro_record_user_game_event(
    new.room_id,new.user_id,new.game_id,'online',
    case when new.placement=1 then 'win' else 'loss' end,null,null,
    pg_catalog.jsonb_build_object(
      'source','sevens-server','serverVerified',true,
      'placement',new.placement,'ratingDelta',new.rating_delta,
      'roomId',new.room_id
    )
  );
  return new;
end;
$function$;

drop trigger if exists kuro_sevens_result_user_records on public.game_sevens_results;
create trigger kuro_sevens_result_user_records
after insert on public.game_sevens_results
for each row execute function public.kuro_sync_sevens_result_to_user_records();

create or replace function public.kuro_sync_number_session_to_user_records()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  v_play_mode text;
  v_level text;
  v_mode text;
  v_result text;
  v_elapsed bigint;
  v_is_time boolean;
begin
  if new.game_type <> 'number_guess' or new.status <> 'completed'
    or new.result not in ('correct','failed') then
    return new;
  end if;
  v_play_mode := coalesce(new.state->>'playMode','');
  v_level := lower(coalesce(new.state->>'level',''));
  if v_play_mode not in ('classic','time')
    or v_level not in ('easy','normal','hard','expert','master','legend') then
    return new;
  end if;
  if v_play_mode='time' and new.result <> 'correct' then return new; end if;

  v_is_time := v_play_mode='time';
  v_mode := 'number-' || v_play_mode || '-' || v_level;
  v_result := case when new.result='correct' then 'win' else 'loss' end;
  v_elapsed := greatest(0,floor(extract(epoch from (
    coalesce(new.completed_at,pg_catalog.now()) - new.started_at
  )) * 1000)::bigint);

  perform public.kuro_record_user_game_event(
    new.id,new.user_id,new.game_id,v_mode,v_result,
    case when v_is_time then v_elapsed else null end,v_elapsed,
    pg_catalog.jsonb_build_object(
      'source','number-guess-server','serverVerified',true,
      'metric',case when v_is_time then 'clear_time_ms' else 'completion' end,
      'difficulty',v_level,'rangeMax',new.range_max,'attempts',new.attempts
    )
  );
  return new;
end;
$function$;

drop trigger if exists kuro_number_session_user_records on public.game_verification_sessions;
create trigger kuro_number_session_user_records
after update of status,result on public.game_verification_sessions
for each row
when (
  old.status is distinct from 'completed'
  and new.status='completed'
  and new.game_type='number_guess'
)
execute function public.kuro_sync_number_session_to_user_records();

-- Trigger functions should only be executable through their installed triggers.
revoke all on function public.kuro_sync_win_event_to_user_records() from public, anon, authenticated;
revoke all on function public.kuro_sync_tictactoe_event_to_user_records() from public, anon, authenticated;
revoke all on function public.kuro_sync_sevens_result_to_user_records() from public, anon, authenticated;
revoke all on function public.kuro_sync_number_session_to_user_records() from public, anon, authenticated;

-- Reconstruct all historical event-based records. This remains idempotent.
do $block$
declare
  r record;
  v_play_mode text;
  v_level text;
  v_elapsed bigint;
begin
  for r in
    select submission_id,user_id,game_id,mode,level,cpu_difficulty
    from public.kuro_game_win_events
  loop
    perform public.kuro_record_user_game_event(
      r.submission_id,r.user_id,r.game_id,r.mode,'win',1,null,
      pg_catalog.jsonb_build_object(
        'metric','wins','source','legacy-win-event',
        'level',r.level,'cpuDifficulty',r.cpu_difficulty,'legacyBackfill',true
      )
    );
  end loop;

  for r in
    select submission_id,user_id,game_id,rule,result,cpu_difficulty
    from public.game_tictactoe_verified_events
  loop
    perform public.kuro_record_user_game_event(
      r.submission_id,r.user_id,r.game_id,r.rule,r.result,
      case when r.result='win' then 1 else null end,null,
      pg_catalog.jsonb_build_object(
        'source','tictactoe-server','serverVerified',true,
        'rule',r.rule,'cpuDifficulty',r.cpu_difficulty,'legacyBackfill',true
      )
    );
  end loop;

  for r in
    select room_id,user_id,game_id,placement,rating_delta
    from public.game_sevens_results
  loop
    perform public.kuro_record_user_game_event(
      r.room_id,r.user_id,r.game_id,'online',
      case when r.placement=1 then 'win' else 'loss' end,null,null,
      pg_catalog.jsonb_build_object(
        'source','sevens-server','serverVerified',true,
        'placement',r.placement,'ratingDelta',r.rating_delta,
        'roomId',r.room_id,'legacyBackfill',true
      )
    );
  end loop;

  for r in
    select id,user_id,game_id,state,result,range_max,attempts,started_at,completed_at
    from public.game_verification_sessions
    where game_type='number_guess' and status='completed'
      and result in ('correct','failed')
  loop
    v_play_mode := coalesce(r.state->>'playMode','');
    v_level := lower(coalesce(r.state->>'level',''));
    if v_play_mode not in ('classic','time')
      or v_level not in ('easy','normal','hard','expert','master','legend') then
      continue;
    end if;
    if v_play_mode='time' and r.result<>'correct' then continue; end if;
    v_elapsed := greatest(0,floor(extract(epoch from (
      coalesce(r.completed_at,pg_catalog.now())-r.started_at
    ))*1000)::bigint);

    perform public.kuro_record_user_game_event(
      r.id,r.user_id,r.game_id,'number-'||v_play_mode||'-'||v_level,
      case when r.result='correct' then 'win' else 'loss' end,
      case when v_play_mode='time' then v_elapsed else null end,v_elapsed,
      pg_catalog.jsonb_build_object(
        'source','number-guess-server','serverVerified',true,
        'metric',case when v_play_mode='time' then 'clear_time_ms' else 'completion' end,
        'difficulty',v_level,'rangeMax',r.range_max,'attempts',r.attempts,'legacyBackfill',true
      )
    );
  end loop;
end;
$block$;

-- game_scores retains best/cumulative snapshots, not every play. Import values as
-- best records only; never synthesize plays or historical win events from snapshots.
insert into public.kuro_game_user_stats(
  user_id,game_id,mode,plays,wins,losses,draws,
  best_score,best_time_ms,total_time_ms,last_played_at,metadata,updated_at
)
select
  s.user_id,s.game_id,s.mode,0,0,0,0,
  case when bool_or(
    s.mode ~* '(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)'
    or coalesce(s.metadata->>'metric','')='clear_time_ms'
  ) then null else max(s.score) end,
  case when bool_or(
    s.mode ~* '(^|[_-])(time|duration|elapsed|seconds?|milliseconds?|ms|fastest|clear_time)([_-]|$)'
    or coalesce(s.metadata->>'metric','')='clear_time_ms'
  ) then min(s.score) else null end,
  0,max(s.created_at),
  pg_catalog.jsonb_build_object(
    'legacyBestRecord',true,'sourceTable','game_scores',
    'note','Legacy table retained best/cumulative values, not the full play history'
  ),
  pg_catalog.now()
from public.game_scores s
where coalesce(s.metadata->>'metric','') <> 'wins'
  and coalesce(s.metadata->>'source','') not like 'tictactoe%'
group by s.user_id,s.game_id,s.mode
on conflict (user_id,game_id,mode) do update set
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
  last_played_at = greatest(
    coalesce(public.kuro_game_user_stats.last_played_at,'-infinity'::timestamptz),
    coalesce(excluded.last_played_at,'-infinity'::timestamptz)
  ),
  metadata = public.kuro_game_user_stats.metadata || excluded.metadata,
  updated_at = pg_catalog.now();
