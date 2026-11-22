create table if not exists public.public_chat_daily_stats (
  chat_date date primary key,
  message_count bigint not null default 0 check (message_count >= 0),
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.public_chat_daily_stats enable row level security;

revoke all on table public.public_chat_daily_stats from public, anon, authenticated;
grant select on table public.public_chat_daily_stats to service_role;

comment on table public.public_chat_daily_stats is
  'Daily counts of public lobby chat messages, grouped by Asia/Tokyo calendar date. Stores counts only; chat content is still deleted daily.';

create or replace function public.kuro_archive_and_clear_public_chat()
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_archived_messages bigint := 0;
  v_archived_days integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('kuro_archive_and_clear_public_chat', 0)
  ) then
    return pg_catalog.jsonb_build_object(
      'skipped', true,
      'reason', 'archive_already_running'
    );
  end if;

  with deleted as materialized (
    delete from public.public_chat_messages
    returning (created_at at time zone 'Asia/Tokyo')::date as chat_date
  ),
  aggregated as materialized (
    select chat_date, pg_catalog.count(*)::bigint as message_count
    from deleted
    group by chat_date
  ),
  upserted as (
    insert into public.public_chat_daily_stats (chat_date, message_count, updated_at)
    select chat_date, message_count, pg_catalog.now()
    from aggregated
    on conflict (chat_date) do update
      set message_count = public.public_chat_daily_stats.message_count + excluded.message_count,
          updated_at = pg_catalog.now()
    returning chat_date
  )
  select
    coalesce((select pg_catalog.sum(message_count) from aggregated), 0)::bigint,
    coalesce((select pg_catalog.count(*) from upserted), 0)::integer
  into v_archived_messages, v_archived_days;

  return pg_catalog.jsonb_build_object(
    'archivedMessages', v_archived_messages,
    'archivedDays', v_archived_days,
    'chatContentDeleted', true,
    'dailyCountsPreserved', true
  );
end;
$function$;

revoke all on function public.kuro_archive_and_clear_public_chat()
  from public, anon, authenticated;

grant execute on function public.kuro_archive_and_clear_public_chat()
  to service_role;

comment on function public.kuro_archive_and_clear_public_chat() is
  'Atomically snapshots public lobby chat message counts by Asia/Tokyo date and deletes message content. Safe to retry; uses an advisory transaction lock.';

select cron.schedule(
  'kuro-delete-public-chat-daily',
  '0 15 * * *',
  'select public.kuro_archive_and_clear_public_chat();'
);
