-- Create per-user, per-game, per-mode aggregates and immutable play history.
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

alter table public.kuro_game_user_stats enable row level security;
alter table public.kuro_game_play_events enable row level security;

drop policy if exists kuro_game_user_stats_public_read on public.kuro_game_user_stats;
create policy kuro_game_user_stats_public_read on public.kuro_game_user_stats
  for select to anon, authenticated using (true);
drop policy if exists kuro_game_user_stats_insert_own on public.kuro_game_user_stats;
create policy kuro_game_user_stats_insert_own on public.kuro_game_user_stats
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists kuro_game_user_stats_update_own on public.kuro_game_user_stats;
create policy kuro_game_user_stats_update_own on public.kuro_game_user_stats
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists kuro_game_play_events_read_own on public.kuro_game_play_events;
create policy kuro_game_play_events_read_own on public.kuro_game_play_events
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists kuro_game_play_events_insert_own on public.kuro_game_play_events;
create policy kuro_game_play_events_insert_own on public.kuro_game_play_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

revoke insert, update, delete on public.kuro_game_user_stats from anon, authenticated;
revoke insert, update, delete on public.kuro_game_play_events from anon, authenticated;
grant select on public.kuro_game_user_stats to anon, authenticated;
grant select on public.kuro_game_play_events to authenticated;
grant insert, update on public.kuro_game_user_stats to authenticated;
grant insert on public.kuro_game_play_events to authenticated;
