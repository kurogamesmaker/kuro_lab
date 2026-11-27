
alter table public.user_last_activity
  drop constraint if exists user_last_activity_activity_source_check;
alter table public.user_last_activity
  add constraint user_last_activity_activity_source_check
  check (activity_source in ('portal', 'sns', 'games', 'auth'));

create or replace function private.capture_user_last_activity_from_usage_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_source text := case when new.page_key = 'sns' then 'sns' else 'portal' end;
begin
  if new.user_id is null
     or new.event_name not in ('page_view', 'session_start', 'activity_ping') then
    return new;
  end if;

  insert into public.user_last_activity (
    user_id, last_activity_at, last_page_key, activity_source, updated_at
  )
  values (
    new.user_id, v_now, new.page_key, v_source, v_now
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
        then excluded.activity_source
      else public.user_last_activity.activity_source
    end,
    updated_at = greatest(public.user_last_activity.updated_at, excluded.updated_at);

  return new;
end;
$$;

revoke all on function private.capture_user_last_activity_from_usage_event()
  from public, anon, authenticated;
