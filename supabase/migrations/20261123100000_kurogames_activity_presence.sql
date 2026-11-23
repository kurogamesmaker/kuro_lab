-- KURO GAMES real-time activity presence.
-- All reads/writes are mediated by the server-side Edge Function; no user identifiers
-- are exposed to the public activity page.
create table if not exists public.game_activity_presence (
  presence_key text primary key,
  game_id uuid not null references public.game_studio_games(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  guest_id uuid,
  status text not null default 'playing'
    check (status in ('playing', 'waiting')),
  opponent_type text not null default 'unknown'
    check (opponent_type in ('human', 'bot', 'solo', 'unknown')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint game_activity_presence_identity_check
    check (
      (user_id is not null and guest_id is null)
      or (user_id is null and guest_id is not null)
    )
);

create index if not exists game_activity_presence_game_seen_idx
  on public.game_activity_presence (game_id, last_seen_at desc);
create index if not exists game_activity_presence_seen_idx
  on public.game_activity_presence (last_seen_at);

alter table public.game_activity_presence enable row level security;
revoke all on table public.game_activity_presence from public, anon, authenticated;
grant select, insert, update, delete on table public.game_activity_presence to service_role;

comment on table public.game_activity_presence is
  'Short-lived KURO GAMES activity heartbeats. Access only through kuro games activity Edge Function; presence expires after 75 seconds.';
