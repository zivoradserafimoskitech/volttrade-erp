-- Scheduled jobs (pg_cron + pg_net). NOT an auto-migration because it needs
-- your project ref and service role key. Run ONCE in Supabase SQL Editor
-- after replacing <PROJECT_REF> and <SERVICE_ROLE_KEY>.
--
-- P0-3 (audit): these jobs present the SERVICE ROLE key as Bearer. Until
-- 2026-08-11 the target functions called auth.getUser() and required a real
-- user, so a service-role JWT (which carries no `sub` claim) failed and EVERY
-- SCHEDULED RUN RETURNED 401 — silently. Only the manual buttons in the UI
-- worked. supabase/functions/_shared/auth.ts now recognises the service-role
-- caller explicitly.
--
-- VERIFY AFTER DEPLOY:
--   select * from public.external_api_log
--    where provider = 'volttrade-cloud' order by called_at desc limit 5;
--   -- expect rows appearing every 30 minutes with status 200 and
--   -- detail->>'caller' = 'service'.
-- Project ref = the subdomain in your Supabase URL (https://<PROJECT_REF>.supabase.co)
-- Service role key: Dashboard → Settings → API → service_role.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 30 min: pull telemetry from the VoltTrade Cloud gateway platform
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

-- Weekly, Monday 03:00 UTC: rebuild the per-meter hourly load curves for
-- MEASURED (>40 kW) points. Safe to run with zero data — it just reports that
-- nothing has enough history yet.
select cron.schedule('build-meter-profiles', '0 3 * * 1', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/build-meter-profiles',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb);
$$);

-- Test phase: ELEX day-ahead (twice daily, well under the 50/day cap)
select cron.schedule('sync-elex-prices', '15 13,15 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-elex-prices',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{}'::jsonb);
$$);


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3 — control loop and gateway integration
--
-- All three present the SERVICE ROLE key; _shared/auth.ts recognises that
-- caller explicitly (see the P0-3 note at the top of this file).
-- ═══════════════════════════════════════════════════════════════════════════

-- Every 15 min: push due dispatch to the gateway EMS.
--
-- CADENCE RATIONALE: plans are pushed with a 24h horizon, so a single missed
-- run changes nothing — the previously pushed plan is still valid and the
-- gateway keeps executing it. 15 minutes means a schedule edited by a trader
-- reaches the plant within one settlement period.
select cron.schedule(
  'push-ems-plan',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/push-ems-plan',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Every 15 min: asset telemetry (BESS/PV) from the gateway. Replaces the
-- InfluxDB pull — see the Phase 3 notes in sync-asset-telemetry.
select cron.schedule(
  'sync-asset-telemetry',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-asset-telemetry',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{"window_minutes":120,"bucket_minutes":15}'::jsonb
  );
  $$
);

-- Every 5 min: mirror gateway alarms. Tighter cadence because an unnoticed
-- critical alarm is the expensive failure here.
select cron.schedule(
  'sync-gateway-alarms',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-gateway-alarms',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Weekly: prune the lead throttle table (P1-13).
select cron.schedule('prune-lead-throttle', '0 4 * * 0', $$ select public.prune_lead_throttle(); $$);

-- ── VERIFY PHASE 3 ─────────────────────────────────────────────────────────
--   select called_at, endpoint, status, detail->>'plans_pushed'
--     from public.external_api_log
--    where provider = 'volttrade-cloud' order by called_at desc limit 10;
--
--   -- dispatch that actually reached the plant:
--   select status, count(*) from public.asset_dispatch_schedules group by 1;
--   -- rows in 'sent' must carry gateway_plan_id (enforced by CHECK).
