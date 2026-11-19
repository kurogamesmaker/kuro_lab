create table if not exists public.kuro_secret_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  code_hash text not null unique,
  room_key text not null check (room_key ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  room_title text not null check (char_length(btrim(room_title)) between 1 and 80),
  enabled boolean not null default false,
  starts_at timestamptz,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses between 1 and 1000000),
  use_count integer not null default 0 check (use_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kuro_secret_code_date_order check (expires_at is null or starts_at is null or expires_at > starts_at)
);
create index if not exists kuro_secret_codes_room_idx on public.kuro_secret_codes(room_key);
create index if not exists kuro_secret_codes_enabled_idx on public.kuro_secret_codes(enabled, expires_at);
create table if not exists public.kuro_secret_content (
  id uuid primary key default gen_random_uuid(),
  room_key text not null check (room_key ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  content_type text not null check (content_type in ('game','diary','mission','news')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 12000),
  href text not null default '' check (char_length(href) <= 1000),
  icon text not null default '' check (char_length(icon) <= 24),
  reward text not null default '' check (char_length(reward) <= 120),
  sort_order integer not null default 100,
  published boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kuro_secret_content_date_order check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists kuro_secret_content_room_idx
  on public.kuro_secret_content(room_key, published, content_type, sort_order, created_at desc);
create table if not exists public.kuro_secret_attempt_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now()
);
alter table public.kuro_secret_codes enable row level security;
alter table public.kuro_secret_content enable row level security;
alter table public.kuro_secret_attempt_limits enable row level security;
revoke all on table public.kuro_secret_codes from public, anon, authenticated;
revoke all on table public.kuro_secret_content from public, anon, authenticated;
revoke all on table public.kuro_secret_attempt_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.kuro_secret_codes to service_role;
grant select, insert, update, delete on table public.kuro_secret_content to service_role;
grant select, insert, update, delete on table public.kuro_secret_attempt_limits to service_role;
create or replace function public.kuro_secret_consume_code(p_code_id uuid)
returns boolean language plpgsql set search_path = public as $$
begin
  update public.kuro_secret_codes set use_count = use_count + 1, updated_at = now()
   where id = p_code_id and enabled = true
     and (starts_at is null or starts_at <= now())
     and (expires_at is null or expires_at > now())
     and (max_uses is null or use_count < max_uses);
  return found;
end; $$;
create or replace function public.kuro_secret_record_failure(p_key_hash text, p_window_seconds integer default 900)
returns integer language plpgsql set search_path = public as $$
declare current_attempts integer;
  window_seconds integer := greatest(60, least(coalesce(p_window_seconds, 900), 86400));
begin
  insert into public.kuro_secret_attempt_limits as limits (key_hash, window_started_at, attempts, updated_at)
  values (p_key_hash, now(), 1, now())
  on conflict (key_hash) do update
    set window_started_at = case when limits.window_started_at < now() - make_interval(secs => window_seconds) then now() else limits.window_started_at end,
        attempts = case when limits.window_started_at < now() - make_interval(secs => window_seconds) then 1 else limits.attempts + 1 end,
        updated_at = now()
  returning attempts into current_attempts;
  return current_attempts;
end; $$;
revoke all on function public.kuro_secret_consume_code(uuid) from public, anon, authenticated;
revoke all on function public.kuro_secret_record_failure(text, integer) from public, anon, authenticated;
grant execute on function public.kuro_secret_consume_code(uuid) to service_role;
grant execute on function public.kuro_secret_record_failure(text, integer) to service_role;
comment on table public.kuro_secret_codes is 'KUROGAMES SECRET access codes. Only trusted Edge Functions can read or modify this table. Codes are HMAC hashes.';
comment on table public.kuro_secret_content is 'KUROGAMES SECRET room content: hidden games, developer diaries, missions, and limited announcements.';
comment on table public.kuro_secret_attempt_limits is 'Privacy-preserving rate limit buckets for failed KUROGAMES SECRET code attempts.';
