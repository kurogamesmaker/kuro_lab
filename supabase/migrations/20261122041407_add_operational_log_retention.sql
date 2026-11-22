create index if not exists admin_email_logs_created_at_idx
  on public.admin_email_logs (created_at desc);

create or replace function public.kuro_cleanup_operational_logs(
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_usage_cutoff timestamptz := pg_catalog.now() - interval '90 days';
  v_audit_cutoff timestamptz := pg_catalog.now() - interval '365 days';
  v_email_cutoff timestamptz := pg_catalog.now() - interval '90 days';
  v_cron_cutoff timestamptz := pg_catalog.now() - interval '14 days';

  v_would_usage integer := 0;
  v_would_audit integer := 0;
  v_would_email integer := 0;
  v_would_cron integer := 0;

  v_deleted_usage integer := 0;
  v_deleted_audit integer := 0;
  v_deleted_email integer := 0;
  v_deleted_cron integer := 0;
  v_batch integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('kuro_cleanup_operational_logs', 0)
  ) then
    return pg_catalog.jsonb_build_object(
      'skipped', true,
      'reason', 'cleanup_already_running'
    );
  end if;

  select pg_catalog.count(*)::integer into v_would_usage
    from public.usage_events
    where created_at < v_usage_cutoff;

  select pg_catalog.count(*)::integer into v_would_audit
    from public.admin_audit_logs
    where created_at < v_audit_cutoff;

  select pg_catalog.count(*)::integer into v_would_email
    from public.admin_email_logs
    where created_at < v_email_cutoff;

  select pg_catalog.count(*)::integer into v_would_cron
    from cron.job_run_details
    where start_time < v_cron_cutoff;

  if p_dry_run then
    return pg_catalog.jsonb_build_object(
      'dryRun', true,
      'wouldDeleteUsageEvents', v_would_usage,
      'wouldDeleteAdminAuditLogs', v_would_audit,
      'wouldDeleteAdminEmailLogs', v_would_email,
      'wouldDeleteCronRunHistory', v_would_cron,
      'retentionDays', pg_catalog.jsonb_build_object(
        'usageEvents', 90,
        'adminAuditLogs', 365,
        'adminEmailLogs', 90,
        'cronRunHistory', 14
      ),
      'userContentTouched', false
    );
  end if;

  loop
    with stale as (
      select ctid
      from public.usage_events
      where created_at < v_usage_cutoff
      order by created_at
      limit 2000
      for update skip locked
    )
    delete from public.usage_events as target
    using stale
    where target.ctid = stale.ctid;

    get diagnostics v_batch = row_count;
    v_deleted_usage := v_deleted_usage + v_batch;
    exit when v_batch = 0;
  end loop;

  loop
    with stale as (
      select ctid
      from public.admin_audit_logs
      where created_at < v_audit_cutoff
      order by created_at
      limit 2000
      for update skip locked
    )
    delete from public.admin_audit_logs as target
    using stale
    where target.ctid = stale.ctid;

    get diagnostics v_batch = row_count;
    v_deleted_audit := v_deleted_audit + v_batch;
    exit when v_batch = 0;
  end loop;

  loop
    with stale as (
      select ctid
      from public.admin_email_logs
      where created_at < v_email_cutoff
      order by created_at
      limit 2000
      for update skip locked
    )
    delete from public.admin_email_logs as target
    using stale
    where target.ctid = stale.ctid;

    get diagnostics v_batch = row_count;
    v_deleted_email := v_deleted_email + v_batch;
    exit when v_batch = 0;
  end loop;

  loop
    with stale as (
      select ctid
      from cron.job_run_details
      where start_time < v_cron_cutoff
      order by start_time
      limit 2000
      for update skip locked
    )
    delete from cron.job_run_details as target
    using stale
    where target.ctid = stale.ctid;

    get diagnostics v_batch = row_count;
    v_deleted_cron := v_deleted_cron + v_batch;
    exit when v_batch = 0;
  end loop;

  return pg_catalog.jsonb_build_object(
    'dryRun', false,
    'deletedUsageEvents', v_deleted_usage,
    'deletedAdminAuditLogs', v_deleted_audit,
    'deletedAdminEmailLogs', v_deleted_email,
    'deletedCronRunHistory', v_deleted_cron,
    'userContentTouched', false
  );
end;
$function$;

revoke all on function public.kuro_cleanup_operational_logs(boolean)
  from public, anon, authenticated;

comment on function public.kuro_cleanup_operational_logs(boolean) is
  'Daily operational log retention: usage events 90d, admin audit logs 365d, admin email logs 90d, pg_cron run history 14d. Does not delete user-generated content. Supports read-only dry run.';

select cron.schedule(
  'kuro-cleanup-operational-logs',
  '30 15 * * *',
  'select public.kuro_cleanup_operational_logs();'
);
