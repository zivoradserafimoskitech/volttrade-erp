-- ═══════════════════════════════════════════════════════════════════════════
-- VoltTrade Forecast Accuracy Tracking — Database Setup
-- Target path in repo: supabase/migrations/20260902090000_forecast_tracking.sql
--
-- Logs every issued point forecast (p10/p50/p90) into
-- public.forecast_predictions; the analytics service scorer
-- (python-service/tracking/predictions.py) later fills `actual` from
-- market_price_history (price) / load_history (load). The
-- v_forecast_accuracy view aggregates 30-day accuracy metrics per
-- (organization, model_kind, zone).
--
-- Same ownership/RLS pattern as 20260901090000_risk_module.sql /
-- 20260901090100_load_module.sql.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Forecast prediction log
CREATE TABLE IF NOT EXISTS public.forecast_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  target_time timestamptz NOT NULL,
  zone text NOT NULL,
  model_kind text NOT NULL CHECK (model_kind IN ('price','load')),
  model_version text,
  horizon_hours integer NOT NULL,
  p10 double precision,
  p50 double precision,
  p90 double precision,
  actual double precision,
  scored_at timestamptz,
  UNIQUE (organization_id, target_time, zone, model_kind, created_at)
);

GRANT SELECT, INSERT, UPDATE ON public.forecast_predictions TO authenticated;
GRANT ALL ON public.forecast_predictions TO service_role;
ALTER TABLE public.forecast_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fp_org" ON public.forecast_predictions;
CREATE POLICY "fp_org" ON public.forecast_predictions FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS idx_forecast_predictions_org_target
  ON public.forecast_predictions(organization_id, target_time);

-- 2. Rolling 30-day accuracy summary per (org, model_kind, zone)
CREATE OR REPLACE VIEW public.v_forecast_accuracy
WITH (security_invoker = true) AS
SELECT
  organization_id,
  model_kind,
  zone,
  count(*)::integer AS n,
  avg(abs(actual - p50))::double precision AS mae,
  sqrt(avg((actual - p50) * (actual - p50)))::double precision AS rmse,
  avg(CASE
        WHEN (abs(actual) + abs(p50)) > 0
        THEN 2.0 * abs(actual - p50) / (abs(actual) + abs(p50)) * 100.0
      END)::double precision AS smape,
  avg(actual - p50)::double precision AS bias,
  (avg(CASE WHEN p10 IS NOT NULL AND p90 IS NOT NULL
            THEN CASE WHEN actual BETWEEN p10 AND p90 THEN 1.0 ELSE 0.0 END
       END) * 100.0)::double precision AS coverage_p10_p90,
  max(scored_at) AS last_scored_at
FROM public.forecast_predictions
WHERE actual IS NOT NULL
  AND p50 IS NOT NULL
  AND target_time >= now() - interval '30 days'
GROUP BY organization_id, model_kind, zone;