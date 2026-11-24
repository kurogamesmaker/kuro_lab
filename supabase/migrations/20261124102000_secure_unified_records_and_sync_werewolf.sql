-- Restrict unified records to their owner and include server-authoritative Werewolf wins.
drop policy if exists kuro_game_user_stats_public_read on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_insert_own on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_update_own on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_read_own on public.kuro_game_user_stats;
create policy kuro_game_user_stats_read_own on public.kuro_game_user_stats
for select to authenticated using ((select auth.uid())=user_id);

drop policy if exists kuro_game_play_events_insert_own on public.kuro_game_play_events;
drop policy if exists kuro_game_play_events_read_own on public.kuro_game_play_events;
create policy kuro_game_play_events_read_own on public.kuro_game_play_events
for select to authenticated using ((select auth.uid())=user_id);

revoke all on table public.kuro_game_user_stats from public,anon,authenticated;
revoke all on table public.kuro_game_play_events from public,anon,authenticated;
grant select on table public.kuro_game_user_stats to authenticated;
grant select on table public.kuro_game_play_events to authenticated;
grant select,insert,update,delete on table public.kuro_game_user_stats to service_role;
grant select,insert,update,delete on table public.kuro_game_play_events to service_role;

create or replace function public.kuro_sync_werewolf_score_to_user_records()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.mode not in ('werewolf_villager_wins','werewolf_wolf_wins') then return new; end if;
  perform public.kuro_record_user_game_event(
    new.submission_id,new.user_id,new.game_id,new.mode,'win',1,null,
    pg_catalog.jsonb_build_object(
      'metric','wins','source','werewolf-server','serverVerified',true,
      'legacyMetadata',new.metadata
    )
  );
  return new;
end;
$function$;

drop trigger if exists kuro_werewolf_score_user_records on public.game_scores;
create trigger kuro_werewolf_score_user_records
after insert on public.game_scores
for each row
when (new.mode in ('werewolf_villager_wins','werewolf_wolf_wins'))
execute function public.kuro_sync_werewolf_score_to_user_records();

do $block$
declare r record;
begin
  for r in select submission_id,user_id,game_id,mode,metadata
    from public.game_scores where mode in ('werewolf_villager_wins','werewolf_wolf_wins')
  loop
    perform public.kuro_record_user_game_event(
      r.submission_id,r.user_id,r.game_id,r.mode,'win',1,null,
      pg_catalog.jsonb_build_object(
        'metric','wins','source','werewolf-server','serverVerified',true,
        'legacyMetadata',r.metadata,'legacyBackfill',true
      )
    );
  end loop;
end;
$block$;
