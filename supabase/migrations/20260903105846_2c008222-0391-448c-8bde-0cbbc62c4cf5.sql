-- ═══════════════════════════════════════════════════════════════════════════
-- VoltTrade Self-Improvement Loop — Database Setup (SPEC-selfimprove §1)
-- Target path in repo: supabase/migrations/20260902090100_self_improve.sql
--
-- 1. Promotion metadata on the model registry (forecast_models): when the
--    retrain pipeline promotes a challenger it records promoted_at,
--    previous_champion_id and promotion_reason ('challenger_won'), which
--    enables auto-rollback to the previous champion on live drift
--    (promotion_reason='rollback').
-- 2. retrain_log: one row per retrain run (promoted or not) — the input
--    for self-tuning (2 consecutive unpromoted runs -> hyperparameter grid
--    search). backtest_results is deliberately NOT reused (strategy-PnL
--    table, wrong fit).
--
-- Same ownership/RLS pattern as 20260901090000_risk_module.sql /
-- 20260902090000_forecast_tracking.sql. Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Promotion metadata on forecast_models
ALTER TABLE public.forecast_models
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS previous_champion_id uuid REFERENCES public.forecast_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_reason text;

-- 2. Retrain-attempt log
CREATE TABLE IF NOT EXISTS public.retrain_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_kind text NOT NULL CHECK (model_kind IN ('price','load')),
  created_at timestamptz NOT NULL DEFAULT now(),
  champion_mae double precision,
  challenger_mae double precision,
  promoted boolean NOT NULL DEFAULT false,
  drift boolean NOT NULL DEFAULT false,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_retrain_log_org_kind_created
  ON public.retrain_log (organization_id, model_kind, created_at);

GRANT SELECT, INSERT ON public.retrain_log TO authenticated;
GRANT ALL ON public.retrain_log TO service_role;
ALTER TABLE public.retrain_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "retrain_log_org" ON public.retrain_log;
CREATE POLICY "retrain_log_org" ON public.retrain_log FOR ALL
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());