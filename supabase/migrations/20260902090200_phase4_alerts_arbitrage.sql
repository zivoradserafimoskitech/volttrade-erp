-- ═══════════════════════════════════════════════════════════════════════════
-- VoltTrade Phase 4 — Alerts + Cross-border arbitrage — Database Setup
-- Target path in repo: supabase/migrations/20260902090200_phase4_alerts_arbitrage.sql
--
-- Schema per SPEC-phase4.md §1 (EXACT — parallel coder codes against it).
-- RLS pattern copied from 20260901090000_risk_module.sql:
--   DROP POLICY IF EXISTS + CREATE POLICY via public.current_org_id().
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Alerts
CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('retrain_failure','drift','rollback','promotion','arbitrage','system')),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  body text,
  data jsonb,
  read_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alerts_org" ON public.alerts;
CREATE POLICY "alerts_org" ON public.alerts FOR ALL USING (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS idx_alerts_org_created ON public.alerts(organization_id, created_at DESC);

-- 2. Arbitrage opportunities
CREATE TABLE IF NOT EXISTS public.arbitrage_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  target_date date NOT NULL,
  buy_zone text NOT NULL,
  sell_zone text NOT NULL,
  hour integer NOT NULL CHECK (hour BETWEEN 0 AND 23),
  buy_price double precision NOT NULL,
  sell_price double precision NOT NULL,
  spread_eur_mwh double precision NOT NULL,
  UNIQUE (organization_id, target_date, buy_zone, sell_zone, hour)
);

GRANT SELECT, INSERT, UPDATE ON public.arbitrage_opportunities TO authenticated;
GRANT ALL ON public.arbitrage_opportunities TO service_role;
ALTER TABLE public.arbitrage_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "arb_org" ON public.arbitrage_opportunities;
CREATE POLICY "arb_org" ON public.arbitrage_opportunities FOR ALL USING (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_org_date ON public.arbitrage_opportunities(organization_id, target_date);
