-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3 — CLOSING THE LOOP
--
-- Audit items P0-4 (control loop), §5 (two telemetry stacks, no shared
-- identity), item 18 (alarms), P1-13 (submit-lead abuse).
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. A REAL DEVICE LINK — §5 "no shared identity model"
--
-- The only join between the two systems was metering_points.kimi_meter_id, a
-- nullable integer set by hand, covering meters only. Assets (BESS, PV) had
-- `external_ref`, which pointed at an InfluxDB tag — a third identifier space
-- for the same physical fleet.
--
-- assets.gateway_device_id is the equivalent of kimi_meter_id for assets: the
-- device id in the gateway platform. It is what makes both the EMS plan push
-- and the InfluxDB retirement possible.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS gateway_device_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS assets_gateway_device_unique
  ON public.assets (gateway_device_id)
  WHERE gateway_device_id IS NOT NULL;

COMMENT ON COLUMN public.assets.gateway_device_id IS
  'Device id in the VoltTrade Cloud gateway platform. Drives EMS plan push and '
  'telemetry sync. Unique: one ERP asset per physical device.';

COMMENT ON COLUMN public.assets.external_ref IS
  'DEPRECATED (Phase 3): was the InfluxDB tag. Telemetry now comes from the '
  'gateway via gateway_device_id. Retained for historical rows only.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. DISPATCH TRACKING — P0-4
--
-- asset_dispatch_schedules had a `status` column with values planned/sent/
-- acknowledged/failed, but nothing ever moved it past 'planned' because
-- nothing ever sent anything. Add the fields needed to prove a dispatch
-- actually reached the plant.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.asset_dispatch_schedules
  ADD COLUMN IF NOT EXISTS gateway_plan_id integer,
  ADD COLUMN IF NOT EXISTS sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS last_error     text;

CREATE INDEX IF NOT EXISTS idx_dispatch_pending
  ON public.asset_dispatch_schedules (status, ts_from)
  WHERE status IN ('planned', 'sent', 'failed');

COMMENT ON COLUMN public.asset_dispatch_schedules.gateway_plan_id IS
  'ems_plans.id returned by PUT /api/v1/devices/:id/ems-plan. Non-null proves '
  'this dispatch reached the gateway.';

-- A dispatch row that is 'sent' must carry evidence of the send.
ALTER TABLE public.asset_dispatch_schedules
  DROP CONSTRAINT IF EXISTS dispatch_sent_has_evidence;
ALTER TABLE public.asset_dispatch_schedules
  ADD CONSTRAINT dispatch_sent_has_evidence
  CHECK (status <> 'sent' OR (gateway_plan_id IS NOT NULL AND sent_at IS NOT NULL));


-- ───────────────────────────────────────────────────────────────────────────
-- 3. GATEWAY ALARMS MIRROR — item 18
--
-- The gateway's alarm engine was invisible to the ERP. This table mirrors it.
-- The ERP is a READ-ONLY mirror: acknowledgement and resolution happen in the
-- gateway, where the operator has plant context. Two systems both claiming
-- authority over alarm state produces an alarm acknowledged in one place and
-- still screaming in the other.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gateway_alarms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_alarm_id   bigint NOT NULL UNIQUE,   -- alarms.id in the gateway
  device_id          integer,
  gateway_id         integer,
  asset_id           uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  metering_point_id  uuid REFERENCES public.metering_points(id) ON DELETE SET NULL,
  metric             text NOT NULL,
  value              numeric,
  threshold          numeric,
  severity           text NOT NULL,
  message            text,
  status             text NOT NULL,            -- active | acknowledged | resolved
  triggered_at       timestamptz NOT NULL,
  acknowledged_at    timestamptz,
  resolved_at        timestamptz,
  synced_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gateway_alarms_active
  ON public.gateway_alarms (status, severity, triggered_at DESC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_gateway_alarms_asset
  ON public.gateway_alarms (asset_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_alarms_mp
  ON public.gateway_alarms (metering_point_id, triggered_at DESC);

GRANT SELECT ON public.gateway_alarms TO authenticated;
GRANT ALL ON public.gateway_alarms TO service_role;
ALTER TABLE public.gateway_alarms ENABLE ROW LEVEL SECURITY;

-- Staff read only. Writes come from the sync function under service_role;
-- there is deliberately no INSERT/UPDATE policy, because this is a mirror.
CREATE POLICY "staff read gateway_alarms"
  ON public.gateway_alarms FOR SELECT TO authenticated
  USING (public.is_staff());

COMMENT ON TABLE public.gateway_alarms IS
  'Read-only mirror of the gateway platform alarm engine, refreshed by the '
  'sync-gateway-alarms edge function. Acknowledge and resolve in the gateway, '
  'not here.';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. SUBMIT-LEAD ABUSE CONTROLS — P1-13 (carried from Phase 1)
--
-- submit-lead is a public endpoint (verify_jwt = false) with no rate limit, no
-- captcha and no IP throttle, and it triggers a confirmation email. That is a
-- spam relay and a database-flooding vector.
--
-- Enforced in the database so the limit holds no matter how many edge-function
-- instances are running — an in-process counter would be per-instance.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_submission_throttle (
  ip_hash     text PRIMARY KEY,     -- sha256(ip + salt); never the raw address
  count       int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

ALTER TABLE public.lead_submission_throttle ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only. Never readable by clients.

COMMENT ON TABLE public.lead_submission_throttle IS
  'Rate-limit state for the public submit-lead endpoint. Stores a SALTED HASH '
  'of the client IP, never the address itself, so this is not a visitor log.';

CREATE OR REPLACE FUNCTION public.check_lead_throttle(
  p_ip_hash text,
  p_max_per_window int DEFAULT 5,
  p_window_minutes int DEFAULT 60,
  p_block_minutes int DEFAULT 120
)
RETURNS TABLE (allowed boolean, retry_after_seconds int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.lead_submission_throttle%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  INSERT INTO public.lead_submission_throttle (ip_hash)
  VALUES (p_ip_hash)
  ON CONFLICT (ip_hash) DO NOTHING;

  SELECT * INTO v_row FROM public.lead_submission_throttle
  WHERE ip_hash = p_ip_hash FOR UPDATE;

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN QUERY SELECT false, extract(epoch FROM (v_row.blocked_until - v_now))::int;
    RETURN;
  END IF;

  -- Roll the window if it has elapsed.
  IF v_row.window_start < v_now - make_interval(mins => p_window_minutes) THEN
    UPDATE public.lead_submission_throttle
       SET count = 1, window_start = v_now, blocked_until = NULL
     WHERE ip_hash = p_ip_hash;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  IF v_row.count + 1 > p_max_per_window THEN
    UPDATE public.lead_submission_throttle
       SET blocked_until = v_now + make_interval(mins => p_block_minutes)
     WHERE ip_hash = p_ip_hash;
    RETURN QUERY SELECT false, (p_block_minutes * 60);
    RETURN;
  END IF;

  UPDATE public.lead_submission_throttle
     SET count = v_row.count + 1
   WHERE ip_hash = p_ip_hash;
  RETURN QUERY SELECT true, 0;
END $$;

REVOKE ALL ON FUNCTION public.check_lead_throttle(text, int, int, int) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.check_lead_throttle(text, int, int, int) TO service_role;

-- Housekeeping: drop throttle rows that have gone quiet.
CREATE OR REPLACE FUNCTION public.prune_lead_throttle()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH d AS (
    DELETE FROM public.lead_submission_throttle
    WHERE window_start < now() - interval '7 days'
      AND (blocked_until IS NULL OR blocked_until < now())
    RETURNING 1
  )
  SELECT count(*)::int FROM d;
$$;

GRANT EXECUTE ON FUNCTION public.prune_lead_throttle() TO service_role;
