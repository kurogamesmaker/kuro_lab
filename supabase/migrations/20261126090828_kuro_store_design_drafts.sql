create table if not exists public.kuro_store_design_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  draft_name text not null default '新しいデザイン',
  category text not null check (category in ('background','frame')),
  design_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kuro_store_design_drafts_name_length check (char_length(draft_name) between 1 and 60),
  constraint kuro_store_design_drafts_json_size check (pg_column_size(design_data) <= 131072)
);

create index if not exists kuro_store_design_drafts_owner_updated_idx
  on public.kuro_store_design_drafts (created_by, updated_at desc);

alter table public.kuro_store_design_drafts enable row level security;
revoke all on table public.kuro_store_design_drafts from public, anon, authenticated;
grant select, insert, update, delete on table public.kuro_store_design_drafts to service_role;

comment on table public.kuro_store_design_drafts is
  'Private Shop Studio working drafts for profile backgrounds and avatar frames. Accessible only through authenticated service-side Studio actions.';
