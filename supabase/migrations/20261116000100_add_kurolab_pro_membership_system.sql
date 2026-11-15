-- KUROLAB Pro application, invitation, entitlement, and reapplication controls.
create table if not exists public.pro_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pro_applications_one_pending_per_user
  on public.pro_applications(user_id) where status = 'pending';
create index if not exists pro_applications_created_idx
  on public.pro_applications(created_at desc);
create table if not exists public.pro_user_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reapply_allowed boolean not null default true,
  reapply_after timestamptz,
  admin_note text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.pro_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('active','suspended','revoked','expired')),
  source text not null check (source in ('application','invitation','manual')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  features jsonb not null default '{"workspace_plus":true,"pro_tools":true,"customization_plus":true,"early_access":true}'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pro_memberships_status_expiry_idx
  on public.pro_memberships(status, expires_at);
create table if not exists public.pro_invitations (
  id uuid primary key default gen_random_uuid(),
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null,
  membership_expires_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists pro_invitations_user_status_idx
  on public.pro_invitations(invited_user_id,status,created_at desc);
alter table public.pro_applications enable row level security;
alter table public.pro_user_controls enable row level security;
alter table public.pro_memberships enable row level security;
alter table public.pro_invitations enable row level security;
revoke all on public.pro_applications, public.pro_user_controls, public.pro_memberships, public.pro_invitations from anon, authenticated;
