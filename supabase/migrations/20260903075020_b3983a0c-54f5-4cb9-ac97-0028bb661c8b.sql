do $do$
declare
  v_ref  text := 'iktlktlljshhirbzlniq';
  v_hdr  text := $h$jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key'))$h$;
  v_job  record;
  v_cmd  text;
begin
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
      ('process-email-queue',   '*/2 * * * *', 'process-email-queue',   '{}'),
      ('forecast-volume-daily', '15 6 * * *',  'forecast-volume-daily', '{}')
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