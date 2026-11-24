alter table public.game_verification_sessions
  add column if not exists score_recovery_status text not null default 'pending';

update public.game_verification_sessions
set score_recovery_status = case
  when score_recorded then 'recorded'
  when game_type = 'number_guess'
    and status = 'completed'
    and not (
      state->>'playMode' = 'time'
      and result = 'correct'
      and lower(coalesce(state->>'level','')) in ('easy','normal','hard','expert','master','legend')
      and completed_at is not null
      and floor(extract(epoch from (completed_at-started_at))*1000)::bigint between 500 and 3600000
    )
    then 'not_rankable'
  else 'pending'
end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.game_verification_sessions'::regclass
      and conname = 'game_verification_sessions_score_recovery_status_check'
  ) then
    alter table public.game_verification_sessions
      add constraint game_verification_sessions_score_recovery_status_check
      check (score_recovery_status in ('pending','recorded','not_rankable'));
  end if;
end
$$;

create index if not exists game_verification_sessions_score_recovery_pending_idx
  on public.game_verification_sessions (game_id, user_id, completed_at)
  where status = 'completed'
    and score_recorded = false
    and score_recovery_status = 'pending';

comment on column public.game_verification_sessions.score_recovery_status is
  'Recovery state for verified score processing: pending, recorded, or not_rankable. Non-rankable completed sessions are checked once and excluded from retry.';
