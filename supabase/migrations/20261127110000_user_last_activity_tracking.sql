create table if not exists public.user_last_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_activity_at timestamptz not null default now(),
  last_page_key text,
  activity_source text not null default 'portal'
    check (activity_source in ('portal', 'games', 'auth')),
  updated_at timestamptz not null default now()
);

create index if not exists user_last_activity_at_idx
  on public.user_last_activity (last_activity_at desc);

alter table public.user_last_activity enable row level security;
revoke all on table public.user_last_activity from public, anon, authenticated;
grant select, insert, update, delete on table public.user_last_activity to service_role;

alter table public.usage_events
  drop constraint if exists usage_events_event_name_check;
alter table public.usage_events
  add constraint usage_events_event_name_check
  check (event_name = any (array[
    'page_view'::text,
    'session_start'::text,
    'activity_ping'::text,
    'widget_view'::text,
    'widget_added'::text,
    'widget_removed'::text,
    'api_success'::text,
    'api_error'::text,
    'client_error'::text
  ]));

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.capture_user_last_activity_from_usage_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if new.user_id is null
     or new.event_name not in ('page_view', 'session_start', 'activity_ping') then
    return new;
  end if;

  insert into public.user_last_activity (
    user_id, last_activity_at, last_page_key, activity_source, updated_at
  )
  values (
    new.user_id, v_now, new.page_key, 'portal', v_now
  )
  on conflict (user_id) do update
  set
    last_activity_at = greatest(public.user_last_activity.last_activity_at, excluded.last_activity_at),
    last_page_key = case
      when excluded.last_activity_at >= public.user_last_activity.last_activity_at
        then excluded.last_page_key
      else public.user_last_activity.last_page_key
    end,
    activity_source = case
      when excluded.last_activity_at >= public.user_last_activity.last_activity_at
        then 'portal'
      else public.user_last_activity.activity_source
    end,
    updated_at = greatest(public.user_last_activity.updated_at, excluded.updated_at);

  return new;
end;
$$;

revoke all on function private.capture_user_last_activity_from_usage_event()
  from public, anon, authenticated;

drop trigger if exists usage_events_capture_user_last_activity
  on public.usage_events;
create trigger usage_events_capture_user_last_activity
after insert on public.usage_events
for each row
execute function private.capture_user_last_activity_from_usage_event();

insert into public.user_last_activity (
  user_id, last_activity_at, last_page_key, activity_source, updated_at
)
select distinct on (user_id)
  user_id, created_at, page_key, 'portal', now()
from public.usage_events
where user_id is not null
  and event_name in ('page_view', 'session_start')
order by user_id, created_at desc
on conflict (user_id) do update
set
  last_activity_at = greatest(public.user_last_activity.last_activity_at, excluded.last_activity_at),
  last_page_key = case
    when excluded.last_activity_at >= public.user_last_activity.last_activity_at
      then excluded.last_page_key
    else public.user_last_activity.last_page_key
  end,
  activity_source = case
    when excluded.last_activity_at >= public.user_last_activity.last_activity_at
      then 'portal'
    else public.user_last_activity.activity_source
  end,
  updated_at = now();

insert into public.user_last_activity (
  user_id, last_activity_at, last_page_key, activity_source, updated_at
)
select
  user_id, max(last_seen_at), 'games', 'games', now()
from public.game_activity_presence
where user_id is not null
group by user_id
on conflict (user_id) do update
set
  last_activity_at = greatest(public.user_last_activity.last_activity_at, excluded.last_activity_at),
  last_page_key = case
    when excluded.last_activity_at >= public.user_last_activity.last_activity_at
      then 'games'
    else public.user_last_activity.last_page_key
  end,
  activity_source = case
    when excluded.last_activity_at >= public.user_last_activity.last_activity_at
      then 'games'
    else public.user_last_activity.activity_source
  end,
  updated_at = now();
