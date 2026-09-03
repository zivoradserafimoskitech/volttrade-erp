create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
declare
  v_ref  text := 'iktlktlljshhirbzlniq';
  v_org  text := '00000000-0000-0000-0000-000000000001';
  v_hdr  text := $h$jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'))$h$;
  v_job  record;
  v_cmd  text;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'email_queue_service_role_key') then
    raise exception 'vault secret email_queue_service_role_key not found';
  end if;

  for v_job in
    select * from (values
      ('sync-kimi-meters',     '*/30 * * * *',   'sync-kimi-meters',     '{"window_minutes":60,"bucket_minutes":60}'),
      ('validate-readings',    '10,40 * * * *',  'validate-readings',    '{"window_hours":24}'),
      ('sync-pv-forecast',     '30 5,11 * * *',  'sync-pv-forecast',     '{"horizon_hours":48}'),
      ('forecast-volumes',     '0 6 * * *',      'forecast-volumes',     '{}'),
      ('build-meter-profiles', '0 3 * * 1',      'build-meter-profiles', '{}'),
      ('sync-elex-prices',     '15 13,15 * * *', 'sync-elex-prices',     '{}'),
      ('push-ems-plan',        '*/15 * * * *',   'push-ems-plan',        '{}'),
      ('sync-asset-telemetry', '*/15 * * * *',   'sync-asset-telemetry', '{"window_minutes":120,"bucket_minutes":15}'),
      ('sync-gateway-alarms',  '*/5 * * * *',    'sync-gateway-alarms',  '{}'),
      ('ingest-memo',          '0 5 * * *',      'ingest-memo',          '{"org_id":"__ORG__"}'),
      ('retrain-nightly',      '0 2 * * 1',      'retrain-nightly',      '{}')
    ) as t(jobname, sched, fn, body)
  loop
    v_cmd := format(
      'select net.http_post(url := %L, headers := %s, body := %L::jsonb);',
      'https://' || v_ref || '.supabase.co/functions/v1/' || v_job.fn,
      v_hdr,
      replace(v_job.body, '__ORG__', v_org)
    );
    perform cron.schedule(v_job.jobname, v_job.sched, v_cmd);
  end loop;

  -- ENTSO-E: one call per bidding zone
  perform cron.schedule('sync-entsoe-prices', '45 13 * * *', format(
    'select net.http_post(url := %L, headers := %s, body := %L::jsonb); select net.http_post(url := %L, headers := %s, body := %L::jsonb);',
    'https://' || v_ref || '.supabase.co/functions/v1/sync-entsoe-prices', v_hdr, '{"zone":"HU"}',
    'https://' || v_ref || '.supabase.co/functions/v1/sync-entsoe-prices', v_hdr, '{"zone":"RS"}'
  ));

  -- Weekly lead-throttle prune
  perform cron.schedule('prune-lead-throttle', '0 4 * * 0', 'select public.prune_lead_throttle();');
end
$do$;