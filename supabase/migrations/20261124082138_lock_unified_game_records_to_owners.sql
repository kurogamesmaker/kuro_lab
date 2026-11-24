-- Keep unified personal record payloads private to their owner.
drop policy if exists kuro_game_user_stats_public_read on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_insert_own on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_update_own on public.kuro_game_user_stats;
drop policy if exists kuro_game_user_stats_read_own on public.kuro_game_user_stats;
create policy kuro_game_user_stats_read_own
on public.kuro_game_user_stats
for select to authenticated
using ((select auth.uid())=user_id);

drop policy if exists kuro_game_play_events_insert_own on public.kuro_game_play_events;
drop policy if exists kuro_game_play_events_read_own on public.kuro_game_play_events;
create policy kuro_game_play_events_read_own
on public.kuro_game_play_events
for select to authenticated
using ((select auth.uid())=user_id);

revoke all on table public.kuro_game_user_stats from public,anon,authenticated;
revoke all on table public.kuro_game_play_events from public,anon,authenticated;
grant select on table public.kuro_game_user_stats to authenticated;
grant select on table public.kuro_game_play_events to authenticated;
grant select,insert,update,delete on table public.kuro_game_user_stats to service_role;
grant select,insert,update,delete on table public.kuro_game_play_events to service_role;
