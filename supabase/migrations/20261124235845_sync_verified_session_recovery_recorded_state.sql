create or replace function public.kuro_mark_verified_session_recovery_recorded()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.score_recorded then
    new.score_recovery_status := 'recorded';
  end if;
  return new;
end;
$function$;

drop trigger if exists game_verification_session_recovery_insert on public.game_verification_sessions;
create trigger game_verification_session_recovery_insert
before insert on public.game_verification_sessions
for each row
execute function public.kuro_mark_verified_session_recovery_recorded();

drop trigger if exists game_verification_session_recovery_recorded on public.game_verification_sessions;
create trigger game_verification_session_recovery_recorded
before update of score_recorded on public.game_verification_sessions
for each row
when (new.score_recorded = true)
execute function public.kuro_mark_verified_session_recovery_recorded();

comment on function public.kuro_mark_verified_session_recovery_recorded() is
  'Keeps the recovery state in sync whenever a verified session has its score recorded.';
