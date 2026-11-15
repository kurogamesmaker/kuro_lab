create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  event_name text not null check (event_name in (
    'page_view','session_start','widget_view','widget_added','widget_removed',
    'api_success','api_error','client_error'
  )),
  page_key text check (page_key is null or (char_length(page_key) <= 64 and page_key ~ '^[a-zA-Z0-9_/-]+$')),
  widget_key text check (widget_key is null or (char_length(widget_key) <= 64 and widget_key ~ '^[a-zA-Z0-9_-]+$')),
  service_key text check (service_key is null or service_key in (
    'weather','rss','ogp','supabase_data_api','supabase_auth','supabase_storage',
    'supabase_edge','gas_proxy','other_api'
  )),
  status_code smallint check (status_code is null or status_code between 100 and 599),
  error_code text check (error_code is null or (char_length(error_code) <= 40 and error_code ~ '^[a-zA-Z0-9_-]+$')),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_created_at_idx
  on public.usage_events (created_at desc);
create index if not exists usage_events_user_created_at_idx
  on public.usage_events (user_id, created_at desc);
create index if not exists usage_events_name_created_at_idx
  on public.usage_events (event_name, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists "Users can add their own usage events" on public.usage_events;
create policy "Users can add their own usage events"
  on public.usage_events
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on table public.usage_events from anon;
revoke all on table public.usage_events from authenticated;
grant insert on table public.usage_events to authenticated;
