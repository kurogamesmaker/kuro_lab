-- KUROGAMES ONLINE core: shared rankings and cloud saves.
-- All direct client access is revoked. The Edge Function uses the service-role key server-side.
create table if not exists public.game_online_settings (
  game_id uuid primary key references public.game_studio_games(id) on delete cascade,
  features jsonb not null default '{"ranking": false, "cloudSave": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_online_settings_features_object check (jsonb_typeof(features) = 'object')
);

create table if not exists public.game_scores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.game_studio_games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode varchar(40) not null default 'default',
  score bigint not null check (score >= 0 and score <= 1000000000),
  submission_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint game_scores_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint game_scores_metadata_size check (pg_column_size(metadata) <= 8192),
  constraint game_scores_submission_unique unique (game_id, user_id, submission_id)
);

create index if not exists game_scores_leaderboard_idx
  on public.game_scores (game_id, mode, score desc, created_at asc);
create index if not exists game_scores_user_recent_idx
  on public.game_scores (game_id, user_id, created_at desc);

create table if not exists public.game_saves (
  game_id uuid not null references public.game_studio_games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  save_key varchar(64) not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (game_id, user_id, save_key),
  constraint game_saves_key_not_blank check (length(btrim(save_key)) between 1 and 64),
  constraint game_saves_payload_size check (pg_column_size(payload) <= 65536)
);

create index if not exists game_saves_user_updated_idx
  on public.game_saves (user_id, updated_at desc);

alter table public.game_online_settings enable row level security;
alter table public.game_scores enable row level security;
alter table public.game_saves enable row level security;

revoke all on table public.game_online_settings from public, anon, authenticated;
revoke all on table public.game_scores from public, anon, authenticated;
revoke all on table public.game_saves from public, anon, authenticated;

grant select, insert, update, delete on table public.game_online_settings to service_role;
grant select, insert, update, delete on table public.game_scores to service_role;
grant select, insert, update, delete on table public.game_saves to service_role;

comment on table public.game_online_settings is 'KUROGAMES ONLINE per-game feature configuration. Accessed only by the server-side Edge Function.';
comment on table public.game_scores is 'KUROGAMES ONLINE score submissions. Public leaderboard reads are mediated by the Edge Function.';
comment on table public.game_saves is 'KUROGAMES ONLINE private cloud saves, partitioned by game, user and save key.';
