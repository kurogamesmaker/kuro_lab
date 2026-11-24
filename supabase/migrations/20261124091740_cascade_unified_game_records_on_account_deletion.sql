-- Remove historical record rows whose Auth user has already been deleted.
delete from public.kuro_game_play_events e
where not exists (select 1 from auth.users u where u.id=e.user_id);

delete from public.kuro_game_user_stats s
where not exists (select 1 from auth.users u where u.id=s.user_id);

-- Deleting a KURO account also deletes its private game history and aggregates.
alter table public.kuro_game_user_stats
  add constraint kuro_game_user_stats_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.kuro_game_play_events
  add constraint kuro_game_play_events_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
