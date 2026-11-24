-- KuroGames homepage scrolling banners.
-- Public clients can only select rows that are currently enabled and in their display window.
-- Writes are handled by the admin-console Edge Function after admin_users authorization.

create table if not exists public.kurogames_home_banners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  href text,
  enabled boolean not null default false,
  sort_order integer not null default 100,
  text_color text not null default '#ffffff' check (text_color ~ '^#[0-9A-Fa-f]{6}$'),
  background_color text not null default '#2563eb' check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_size integer not null default 14 check (font_size between 11 and 22),
  speed text not null default 'normal' check (speed in ('slow','normal','fast')),
  icon text check (icon is null or char_length(icon) <= 16),
  is_bold boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kuro_games_home_banners_valid_period check (ends_at is null or ends_at > starts_at)
);

alter table public.kurogames_home_banners enable row level security;
revoke all on table public.kurogames_home_banners from public, anon, authenticated;
grant select on table public.kurogames_home_banners to anon, authenticated;
grant all on table public.kurogames_home_banners to service_role;

drop policy if exists "Public can read active KuroGames home banners" on public.kurogames_home_banners;
create policy "Public can read active KuroGames home banners"
on public.kurogames_home_banners for select to anon, authenticated
using (
  enabled = true and starts_at <= now()
  and (ends_at is null or ends_at > now())
);

comment on table public.kurogames_home_banners is
  'KuroGames homepage scrolling text banners. Public can read only currently active entries; all writes go through the admin-console Edge Function.';
