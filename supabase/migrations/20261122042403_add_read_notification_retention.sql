create index if not exists notifications_read_at_retention_idx
  on public.notifications (read_at)
  where read_at is not null;

create index if not exists portal_request_notifications_read_at_retention_idx
  on public.portal_request_notifications (read_at)
  where read_at is not null;

create or replace function public.kuro_cleanup_read_notifications(
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_notifications_cutoff timestamptz := pg_catalog.now() - interval '90 days';
  v_request_notifications_cutoff timestamptz := pg_catalog.now() - interval '180 days';
  v_would_notifications integer := 0;
  v_would_request_notifications integer := 0;
  v_deleted_notifications integer := 0;
  v_deleted_request_notifications integer := 0;
  v_batch integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('kuro_cleanup_read_notifications', 0)
  ) then
    return pg_catalog.jsonb_build_object(
      'skipped', true,
      'reason', 'cleanup_already_running'
    );
  end if;

  select pg_catalog.count(*)::integer
    into v_would_notifications
  from public.notifications
  where read_at is not null
    and read_at <= v_notifications_cutoff;

  select pg_catalog.count(*)::integer
    into v_would_request_notifications
  from public.portal_request_notifications
  where read_at is not null
    and read_at <= v_request_notifications_cutoff;

  if p_dry_run then
    return pg_catalog.jsonb_build_object(
      'dryRun', true,
      'wouldDeleteReadNotifications', v_would_notifications,
      'wouldDeleteReadPortalRequestNotifications', v_would_request_notifications,
      'retentionDays', pg_catalog.jsonb_build_object(
        'notifications', 90,
        'portalRequestNotifications', 180
      ),
      'unreadNotificationsPreserved', true,
      'chatMessagesTouched', false,
      'readReceiptsTouched', false
    );
  end if;

  loop
    with stale as (
      select n.ctid
      from public.notifications n
      where n.read_at is not null
        and n.read_at <= v_notifications_cutoff
      order by n.read_at asc
      limit 500
      for update skip locked
    )
    delete from public.notifications target
    using stale
    where target.ctid = stale.ctid;

    get diagnostics v_batch = row_count;
    v_deleted_notifications := v_deleted_notifications + v_batch;
    exit when v_batch = 0;
  end loop;

  loop
    with stale as (
      select n.ctid
      from public.portal_request_notifications n
      where n.read_at is not null
        and n.read_at <= v_request_notifications_cutoff
      order by n.read_at asc
      limit 500
      for update skip locked
    )
    delete from public.portal_request_notifications target
    using stale
    where target.ctid = stale.ctid;

    get diagnostics v_batch = row_count;
    v_deleted_request_notifications := v_deleted_request_notifications + v_batch;
    exit when v_batch = 0;
  end loop;

  return pg_catalog.jsonb_build_object(
    'dryRun', false,
    'deletedReadNotifications', v_deleted_notifications,
    'deletedReadPortalRequestNotifications', v_deleted_request_notifications,
    'unreadNotificationsPreserved', true,
    'chatMessagesTouched', false,
    'readReceiptsTouched', false
  );
end;
$function$;

revoke all on function public.kuro_cleanup_read_notifications(boolean)
  from public, anon, authenticated;

grant execute on function public.kuro_cleanup_read_notifications(boolean)
  to service_role;

comment on function public.kuro_cleanup_read_notifications(boolean) is
  'Daily cleanup of read notifications only: social notifications after 90 days and portal request notifications after 180 days. Never deletes unread notifications, chat messages, or read receipts. Supports read-only dry run.';

select cron.schedule(
  'kuro-cleanup-read-notifications',
  '45 15 * * *',
  'select public.kuro_cleanup_read_notifications();'
);
