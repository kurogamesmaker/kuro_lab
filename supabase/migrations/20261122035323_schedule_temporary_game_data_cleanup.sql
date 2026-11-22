-- Schedule the temporary KUROGAMES cleanup function every five minutes.
-- Keep the job idempotent if this migration is reapplied manually.
do $schedule$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'kuro-cleanup-temporary-game-data'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$schedule$;

select cron.schedule(
  'kuro-cleanup-temporary-game-data',
  '*/5 * * * *',
  'select public.kuro_cleanup_temporary_game_data();'
);
