-- Reconcile compact shared game records against authoritative game result sources.
-- No new per-play rows are written to kuro_game_play_events.

create or replace function public.kuro_sync_number_session_to_user_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_play_mode text;
  v_level text;
  v_mode text;
  v_result text;
  v_elapsed bigint;
  v_is_time boolean;
  v_valid_time boolean;
begin
  if new.game_type <> 'number_guess'
    or new.status <> 'completed'
    or new.result not in ('correct','failed') then
    return new;
  end if;

  v_play_mode := coalesce(new.state->>'playMode','');
  v_level := lower(coalesce(new.state->>'level',''));
  if v_play_mode not in ('classic','time')
    or v_level not in ('easy','normal','hard','expert','master','legend') then
    return new;
  end if;
  if v_play_mode='time' and new.result <> 'correct' then
    return new;
  end if;

  v_is_time := v_play_mode='time';
  v_elapsed := greatest(0,floor(extract(epoch from (
    coalesce(new.completed_at,pg_catalog.now()) - new.started_at
  )) * 1000)::bigint);
  v_valid_time := v_is_time and v_elapsed between 500 and 3600000;
  v_mode := 'number-' || v_play_mode || '-' || v_level;
  v_result := case when new.result='correct' then 'win' else 'loss' end;

  perform public.kuro_record_user_game_event(
    new.id,
    new.user_id,
    new.game_id,
    v_mode,
    v_result,
    case when v_valid_time then v_elapsed else null end,
    case when v_is_time and not v_valid_time then null else v_elapsed end,
    pg_catalog.jsonb_build_object(
      'source','number-guess-server',
      'serverVerified',true,
      'metric',case when v_valid_time then 'clear_time_ms' else 'completion' end,
      'verifiedRanking',case when v_valid_time then 'number-guess-v1' else null end,
      'difficulty',v_level,
      'rangeMax',new.range_max,
      'attempts',new.attempts
    )
  );
  return new;
end;
$function$;

-- Tic-Tac-Toe: verified aggregate totals are authoritative for older games
-- that existed before per-match verified events were fully collected.
insert into public.kuro_game_user_stats(
  user_id,game_id,mode,plays,wins,losses,draws,
  best_score,best_time_ms,total_time_ms,last_played_at,metadata,updated_at,recent_submission_ids
)
select
  v.user_id,v.game_id,v.rule,v.played,v.wins,v.losses,v.draws,
  null,null,0,v.updated_at,
  pg_catalog.jsonb_build_object(
    'metric','wins','source','tictactoe-server','serverVerified',true,'rule',v.rule
  ),
  pg_catalog.now(),
  array(
    select e.submission_id
    from public.game_tictactoe_verified_events e
    where e.user_id=v.user_id and e.game_id=v.game_id and e.rule=v.rule
    order by e.created_at desc limit 32
  )
from public.game_tictactoe_verified_stats v
join auth.users au on au.id=v.user_id
on conflict (user_id,game_id,mode) do update set
  plays=excluded.plays,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,
  best_score=null,best_time_ms=null,
  last_played_at=greatest(
    coalesce(public.kuro_game_user_stats.last_played_at,'-infinity'::timestamptz),
    coalesce(excluded.last_played_at,'-infinity'::timestamptz)
  ),
  metadata=public.kuro_game_user_stats.metadata || excluded.metadata,
  updated_at=pg_catalog.now(),
  recent_submission_ids=case
    when cardinality(excluded.recent_submission_ids)>0 then excluded.recent_submission_ids
    else public.kuro_game_user_stats.recent_submission_ids
  end;

-- Number Guess: exact counts come from completed server-created sessions.
-- Verified game_scores rows supply the minimum accepted time.
with session_totals as (
  select
    s.user_id,s.game_id,
    'number-' || (s.state->>'playMode') || '-' || lower(s.state->>'level') as mode,
    count(*)::bigint as plays,
    count(*) filter(where s.result='correct')::bigint as wins,
    count(*) filter(where s.result='failed')::bigint as losses,
    greatest(0,sum(greatest(0,floor(extract(epoch from (
      coalesce(s.completed_at,pg_catalog.now())-s.started_at
    ))*1000)::bigint)))::bigint as total_time_ms,
    max(coalesce(s.completed_at,s.started_at)) as last_played_at,
    (s.state->>'playMode'='time') as is_time_mode,
    lower(s.state->>'level') as difficulty
  from public.game_verification_sessions s
  where s.game_type='number_guess'
    and s.status='completed'
    and s.result in ('correct','failed')
    and s.state->>'playMode' in ('classic','time')
    and lower(s.state->>'level') in ('easy','normal','hard','expert','master','legend')
    and (s.state->>'playMode'<>'time' or s.result='correct')
    and exists(select 1 from auth.users u where u.id=s.user_id)
  group by s.user_id,s.game_id,s.state->>'playMode',lower(s.state->>'level')
),
verified_times as (
  select gs.user_id,gs.game_id,gs.mode,min(gs.score)::bigint as best_time_ms
  from public.game_scores gs
  join auth.users au on au.id=gs.user_id
  where gs.game_id='bb466662-5423-48e6-bbcc-d19da50ba818'::uuid
    and gs.mode like 'number-time-%'
    and gs.metadata->>'serverVerified'='number-guess-v1'
    and gs.score between 500 and 3600000
  group by gs.user_id,gs.game_id,gs.mode
)
insert into public.kuro_game_user_stats(
  user_id,game_id,mode,plays,wins,losses,draws,
  best_score,best_time_ms,total_time_ms,last_played_at,metadata,updated_at,recent_submission_ids
)
select
  t.user_id,t.game_id,t.mode,t.plays,t.wins,t.losses,0,null,
  case when t.is_time_mode then vt.best_time_ms else null end,
  t.total_time_ms,t.last_played_at,
  case when t.is_time_mode and vt.best_time_ms is not null then
    pg_catalog.jsonb_build_object(
      'metric','clear_time_ms','source','number-guess-server',
      'serverVerified','number-guess-v1','verifiedRanking','number-guess-v1',
      'difficulty',t.difficulty
    )
  else
    pg_catalog.jsonb_build_object(
      'metric','completion','source','number-guess-server',
      'serverVerified',true,'difficulty',t.difficulty
    )
  end,
  pg_catalog.now(),
  array(
    select s2.id from public.game_verification_sessions s2
    where s2.user_id=t.user_id and s2.game_id=t.game_id
      and s2.game_type='number_guess' and s2.status='completed'
      and s2.state->>'playMode'=case when t.mode like 'number-time-%' then 'time' else 'classic' end
      and lower(s2.state->>'level')=t.difficulty
      and s2.result in ('correct','failed')
    order by s2.completed_at desc nulls last limit 32
  )
from session_totals t
left join verified_times vt on vt.user_id=t.user_id and vt.game_id=t.game_id and vt.mode=t.mode
on conflict (user_id,game_id,mode) do update set
  plays=excluded.plays,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,
  best_score=null,best_time_ms=excluded.best_time_ms,
  total_time_ms=excluded.total_time_ms,last_played_at=excluded.last_played_at,
  metadata=excluded.metadata,updated_at=pg_catalog.now(),
  recent_submission_ids=case
    when cardinality(excluded.recent_submission_ids)>0 then excluded.recent_submission_ids
    else public.kuro_game_user_stats.recent_submission_ids
  end;

-- Seven's: use every completed server result, excluding orphaned deleted users.
with result_totals as (
  select r.user_id,r.game_id,
    count(*)::bigint as plays,
    count(*) filter(where r.placement=1)::bigint as wins,
    count(*) filter(where r.placement is not null and r.placement<>1)::bigint as losses,
    count(*) filter(where r.placement is null)::bigint as draws,
    max(r.created_at) as last_played_at,
    array(
      select r2.room_id from public.game_sevens_results r2
      where r2.user_id=r.user_id and r2.game_id=r.game_id
      order by r2.created_at desc limit 32
    ) as recent_ids
  from public.game_sevens_results r
  join auth.users au on au.id=r.user_id
  group by r.user_id,r.game_id
)
insert into public.kuro_game_user_stats(
  user_id,game_id,mode,plays,wins,losses,draws,
  best_score,best_time_ms,total_time_ms,last_played_at,metadata,updated_at,recent_submission_ids
)
select user_id,game_id,'online',plays,wins,losses,draws,null,null,0,last_played_at,
  pg_catalog.jsonb_build_object('metric','wins','source','sevens-server','serverVerified',true),
  pg_catalog.now(),recent_ids
from result_totals
on conflict (user_id,game_id,mode) do update set
  plays=excluded.plays,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,
  best_score=null,best_time_ms=null,last_played_at=excluded.last_played_at,
  metadata=public.kuro_game_user_stats.metadata || excluded.metadata,
  updated_at=pg_catalog.now(),
  recent_submission_ids=case
    when cardinality(excluded.recent_submission_ids)>0 then excluded.recent_submission_ids
    else public.kuro_game_user_stats.recent_submission_ids
  end;

-- UNON/Daifugo winner-only ledgers reconstruct wins. Do not invent defeats.
with wins as (
  select w.user_id,w.game_id,w.mode,count(*)::bigint as wins,max(w.created_at) as last_played_at,
    array(
      select w2.submission_id from public.kuro_game_win_events w2
      where w2.user_id=w.user_id and w2.game_id=w.game_id and w2.mode=w.mode
      order by w2.created_at desc limit 32
    ) as recent_ids
  from public.kuro_game_win_events w
  join auth.users au on au.id=w.user_id
  where (w.game_id='2eb37847-1b7e-43e4-ad98-901d5b830ac4'::uuid and w.mode in ('wins-bot','wins-online'))
     or (w.game_id='faa155cb-2143-4361-9a96-dc759d334e46'::uuid and w.mode in ('wins-solo','wins-online'))
  group by w.user_id,w.game_id,w.mode
)
insert into public.kuro_game_user_stats(
  user_id,game_id,mode,plays,wins,losses,draws,
  best_score,best_time_ms,total_time_ms,last_played_at,metadata,updated_at,recent_submission_ids
)
select user_id,game_id,mode,wins,wins,0,0,null,null,0,last_played_at,
  pg_catalog.jsonb_build_object('metric','wins','source','win-event','serverVerified',true),
  pg_catalog.now(),recent_ids
from wins
on conflict (user_id,game_id,mode) do update set
  plays=greatest(public.kuro_game_user_stats.plays,excluded.plays),
  wins=excluded.wins,best_score=null,best_time_ms=null,
  last_played_at=greatest(
    coalesce(public.kuro_game_user_stats.last_played_at,'-infinity'::timestamptz),
    coalesce(excluded.last_played_at,'-infinity'::timestamptz)
  ),
  metadata=public.kuro_game_user_stats.metadata || excluded.metadata,
  updated_at=pg_catalog.now(),
  recent_submission_ids=case
    when cardinality(excluded.recent_submission_ids)>0 then excluded.recent_submission_ids
    else public.kuro_game_user_stats.recent_submission_ids
  end;
