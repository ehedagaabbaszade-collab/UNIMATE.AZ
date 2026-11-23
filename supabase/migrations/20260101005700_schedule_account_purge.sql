-- S3: run the purge-accounts edge function every night so due account deletions really happen.
-- No secret is written here. The job reads two Vault secrets at run time; create them once (owner-approved step):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the WORKER_SECRET edge function secret>', 'worker_secret');
-- Skipped with a notice where pg_cron / pg_net are not installed (local PGlite tests, plain Postgres).
-- Rollback: select cron.unschedule('purge-accounts');

do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-accounts';
    perform cron.schedule('purge-accounts', '17 3 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-accounts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000)
      where exists (select 1 from vault.decrypted_secrets where name = 'project_url')
        and exists (select 1 from vault.decrypted_secrets where name = 'worker_secret')
    $job$);
  else
    raise notice 'pg_cron/pg_net not installed: schedule purge-accounts (POST + x-worker-secret) from another scheduler';
  end if;
end
$outer$;
