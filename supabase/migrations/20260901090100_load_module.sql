-- ═══════════════════════════════════════════════════════════════════════════
-- VoltTrade Load Module — Database Setup
-- Target path in repo: supabase/migrations/20260901090100_load_module.sql
--
-- Zonal actual total load history (ENTSO-E documentType A65, unit MAW=MW).
-- Same ownership/RLS pattern as public.market_price_history
-- (20260901090000_risk_module.sql). Feeds the LightGBM quantile load
-- forecaster (python-service/models/load_forecast.py).
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- Zonal load history (A65 Actual Total Load)
CREATE TABLE IF NOT EXISTS public.load_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,
  zone text NOT NULL,
  load_mw numeric NOT NULL,
  source text NOT NULL DEFAULT 'entsoe',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, timestamp, zone)
);

GRANT SELECT, INSERT ON public.load_history TO authenticated;
GRANT ALL ON public.load_history TO service_role;
ALTER TABLE public.load_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lh_org" ON public.load_history;
CREATE POLICY "lh_org" ON public.load_history FOR ALL USING (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS idx_load_history_lookup ON public.load_history(organization_id, zone, timestamp DESC);
