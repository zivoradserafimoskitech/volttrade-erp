-- Scheduled jobs (pg_cron + pg_net). NOT an auto-migration because it needs
-- your project ref and service role key. Run ONCE in Supabase SQL Editor
-- after replacing <PROJECT_REF> and <SERVICE_ROLE_KEY>.
-- Project ref = the subdomain in your Supabase URL (https://<PROJECT_REF>.supabase.co)
-- Service role key: Dashboard → Settings → API → service_role.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 30 min: pull telemetry from the Kimi platform
select cron.schedule('sync-kimi-meters', '*/30 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-kimi-meters',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{"window_minutes":60,"bucket_minutes":60}'::jsonb);
$$);

-- 10 min later, every hour: VEE over fresh data
select cron.schedule('validate-readings', '10,40 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/validate-readings',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{"window_hours":24}'::jsonb);
$$);

-- Twice daily: PV weather forecast (Open-Meteo updates ~hourly; 05:30/11:30 UTC
-- covers day-ahead nomination and intraday correction)
select cron.schedule('sync-pv-forecast', '30 5,11 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-pv-forecast',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{"horizon_hours":48}'::jsonb);
$$);

-- Daily 06:00 UTC: volume forecast snapshot (audit trail + nomination input)
select cron.schedule('forecast-volumes', '0 6 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/forecast-volumes',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{}'::jsonb);
$$);

-- Inspect: select * from cron.job;   Remove: select cron.unschedule('<name>');

-- Test phase: ELEX day-ahead (twice daily, well under the 50/day cap)
select cron.schedule('sync-elex-prices', '15 13,15 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-elex-prices',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{}'::jsonb);
$$);
