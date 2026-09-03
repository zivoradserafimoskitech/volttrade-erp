-- Audit tail repairs, 2026-09-03.
--
-- 20260903070847, superseded by 20260903071431, is the source of truth for
-- scheduling and registers 13 jobs. Three edge functions that need a schedule
-- are still absent from both.
--
-- 2026-09-03 rebase: 20260903071431 moved the vault secret from
-- `email_queue_service_role_key` to `cron_service_role_key` — that was the fix
-- for the 401s on every scheduled run, because the edge runtime now holds an
-- `sb_secret_...` key while the legacy JWT was still in the vault. This file
-- reads the same new secret, so the jobs below authenticate identically. This file adds them in the same vault-based style
-- and is safe to run repeatedly: cron.schedule() replaces a job of the same
-- name rather than duplicating it.
--
-- process-email-queue is the load-bearing one. Nothing drains the queue today,
-- so every invoice notice and transactional message written by
-- send-invoice-notices / send-transactional-email is enqueued and never
-- delivered — silently, because enqueueing succeeds.

do $do$
declare
  v_ref  text := 'iktlktlljshhirbzlniq';
  v_hdr  text := $h$jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key'))$h$;
  v_job  record;
  v_cmd  text;
begin
  -- Same guards as 20260903070847: skip cleanly on a server without pg_cron
  -- or vault (CI) instead of aborting the chain.
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'vault not available — skipping cron scheduling';
    return;
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron not available — skipping cron scheduling';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_service_role_key') then
    raise exception 'vault secret cron_service_role_key not found';
  end if;

  for v_job in
    select * from (values
      -- Drain the outbound mail queue.
      ('process-email-queue',   '*/2 * * * *', 'process-email-queue',   '{}'),
      -- Day-ahead volume forecast per metering point. The name says daily; it
      -- was never actually scheduled.
      ('forecast-volume-daily', '15 6 * * *',  'forecast-volume-daily', '{}'),
      -- Dunning / invoice notices for anything issued or overdue. Enqueues
      -- mail, so it must run before the queue drain is useful.
      ('send-invoice-notices',  '0 8 * * *',   'send-invoice-notices',  '{}')
    ) as t(jobname, sched, fn, body)
  loop
    v_cmd := format(
      'select net.http_post(url := %L, headers := %s, body := %L::jsonb);',
      'https://' || v_ref || '.supabase.co/functions/v1/' || v_job.fn,
      v_hdr,
      v_job.body
    );
    perform cron.schedule(v_job.jobname, v_job.sched, v_cmd);
  end loop;
end
$do$;
