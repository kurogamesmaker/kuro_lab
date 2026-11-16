alter table public.usage_events
  alter column user_id drop not null;

alter table public.usage_events
  add column if not exists visitor_id uuid;

create index if not exists usage_events_visitor_created_at_idx
  on public.usage_events (visitor_id, created_at desc);

drop policy if exists "Users can add their own usage events" on public.usage_events;
drop policy if exists "Visitors can add usage events" on public.usage_events;

create policy "Visitors can add usage events"
  on public.usage_events
  for insert
  to anon, authenticated
  with check (
    visitor_id is not null
    and (
      user_id is null
      or user_id = (select auth.uid())
    )
  );

grant insert on table public.usage_events to anon, authenticated;
revoke select, update, delete on table public.usage_events from anon, authenticated;
