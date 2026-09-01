-- ═══════════════════════════════════════════════════════════════════════════
-- VoltTrade Risk Module — Database Setup
-- Target path in repo: supabase/migrations/20260901090000_risk_module.sql
--
-- Recovered from deploy-risk-module.yml and repaired:
--   FIX 1: CREATE POLICY IF NOT EXISTS (invalid PostgreSQL) replaced with
--          DROP POLICY IF EXISTS + CREATE POLICY — still idempotent.
--   FIX 2: shape_mask() 'wind_shape' branch had two ELSE clauses (syntax
--          error). Resolved to 1 during 02-06 and 18-23, 0.5 otherwise.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Organization risk settings
CREATE TABLE IF NOT EXISTS public.org_risk_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capital_at_risk_eur numeric NOT NULL DEFAULT 10000,
  margin_target_eur_mwh numeric NOT NULL DEFAULT 8.0,
  min_hedge_ratio numeric NOT NULL DEFAULT 1.00,
  max_open_position_pct numeric NOT NULL DEFAULT 0.00,
  volume_sigma_default numeric NOT NULL DEFAULT 0.15,
  cvar_beta numeric NOT NULL DEFAULT 0.95,
  risk_aversion_lambda numeric NOT NULL DEFAULT 1.0,
  bess_max_cycles_per_day numeric NOT NULL DEFAULT 1.5,
  bess_capex_eur_kwh numeric NOT NULL DEFAULT 200,
  forecast_horizon_hours integer NOT NULL DEFAULT 24,
  forecast_retrain_days integer NOT NULL DEFAULT 7,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE (organization_id)
);

GRANT SELECT, INSERT, UPDATE ON public.org_risk_settings TO authenticated;
GRANT ALL ON public.org_risk_settings TO service_role;
ALTER TABLE public.org_risk_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_risk_sel" ON public.org_risk_settings;
CREATE POLICY "org_risk_sel" ON public.org_risk_settings FOR SELECT USING (organization_id = public.current_org_id());
DROP POLICY IF EXISTS "org_risk_mod" ON public.org_risk_settings;
CREATE POLICY "org_risk_mod" ON public.org_risk_settings FOR ALL USING (organization_id = public.current_org_id());

-- Seed default for existing orgs
INSERT INTO public.org_risk_settings (organization_id, capital_at_risk_eur)
SELECT id, 10000 FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;

-- 2. Profile capture factors
CREATE TABLE IF NOT EXISTS public.profile_capture_factors (
  profile_key text PRIMARY KEY,
  capture_factor numeric NOT NULL CHECK (capture_factor > 0),
  measured_from date NOT NULL,
  measured_to date NOT NULL,
  n_hours integer NOT NULL,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.profile_capture_factors
  (profile_key, capture_factor, measured_from, measured_to, n_hours, note)
VALUES
  ('flat_3shift', 1.0000, '2024-01-01', '2026-08-22', 21993, 'baseline reference'),
  ('2shift_06_22', 1.0133, '2024-01-01', '2026-08-22', 21993, 'catches evening peak'),
  ('1shift_08_16', 0.8011, '2024-01-01', '2026-08-22', 21993, 'BEST PROFILE — midday trough'),
  ('daytime_solar', 0.8359, '2024-01-01', '2026-08-22', 21993, 'good profile'),
  ('night_heavy', 1.1245, '2024-01-01', '2026-08-22', 21993, 'WORST — evening peak'),
  ('weekend_light', 0.9234, '2024-01-01', '2026-08-22', 21993, 'weekend only')
ON CONFLICT (profile_key) DO UPDATE
  SET capture_factor = EXCLUDED.capture_factor,
      measured_to = EXCLUDED.measured_to,
      n_hours = EXCLUDED.n_hours,
      updated_at = now();

ALTER TABLE public.profile_capture_factors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pcf_sel" ON public.profile_capture_factors;
CREATE POLICY "pcf_sel" ON public.profile_capture_factors FOR SELECT TO authenticated USING (true);

-- 3. Market price history
CREATE TABLE IF NOT EXISTS public.market_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,
  zone text NOT NULL DEFAULT 'MK',
  product text NOT NULL,
  price_eur_mwh numeric NOT NULL,
  volume_mwh numeric,
  source text NOT NULL DEFAULT 'memo',
  available_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, timestamp, zone, product)
);

GRANT SELECT, INSERT ON public.market_price_history TO authenticated;
GRANT ALL ON public.market_price_history TO service_role;
ALTER TABLE public.market_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mph_org" ON public.market_price_history;
CREATE POLICY "mph_org" ON public.market_price_history FOR ALL USING (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS idx_market_price_history_lookup ON public.market_price_history(organization_id, zone, product, timestamp DESC);

-- 4. Forecast models
CREATE TABLE IF NOT EXISTS public.forecast_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  model_type text NOT NULL,
  horizon_hours integer NOT NULL DEFAULT 24,
  features_json jsonb NOT NULL DEFAULT '{}',
  hyperparams_json jsonb NOT NULL DEFAULT '{}',
  mae numeric,
  rmse numeric,
  capture_ratio_pct numeric,
  coverage_pct numeric,
  last_trained_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  model_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.forecast_models TO authenticated;
GRANT ALL ON public.forecast_models TO service_role;
ALTER TABLE public.forecast_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fm_org" ON public.forecast_models;
CREATE POLICY "fm_org" ON public.forecast_models FOR ALL USING (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS idx_forecast_models_org ON public.forecast_models(organization_id, is_active);

-- 5. Backtest results
CREATE TABLE IF NOT EXISTS public.backtest_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_id uuid REFERENCES public.forecast_models(id),
  strategy_name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  total_days integer NOT NULL,
  total_profit_eur numeric NOT NULL,
  avg_daily_profit_eur numeric NOT NULL,
  max_drawdown_eur numeric NOT NULL,
  sharpe_ratio numeric,
  capture_ratio_pct numeric,
  win_rate_pct numeric,
  scenarios_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.backtest_results TO authenticated;
GRANT ALL ON public.backtest_results TO service_role;
ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "br_org" ON public.backtest_results;
CREATE POLICY "br_org" ON public.backtest_results FOR ALL USING (organization_id = public.current_org_id());

-- 6. BESS dispatch schedules
CREATE TABLE IF NOT EXISTS public.bess_dispatch_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id),
  delivery_date date NOT NULL,
  hour_of_day integer NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  charge_mw numeric NOT NULL DEFAULT 0,
  discharge_mw numeric NOT NULL DEFAULT 0,
  soc_pct numeric NOT NULL,
  price_forecast_eur_mwh numeric,
  price_actual_eur_mwh numeric,
  revenue_eur numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, asset_id, delivery_date, hour_of_day)
);

GRANT SELECT, INSERT, UPDATE ON public.bess_dispatch_schedules TO authenticated;
GRANT ALL ON public.bess_dispatch_schedules TO service_role;
ALTER TABLE public.bess_dispatch_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bds_org" ON public.bess_dispatch_schedules;
CREATE POLICY "bds_org" ON public.bess_dispatch_schedules FOR ALL USING (organization_id = public.current_org_id());
CREATE INDEX IF NOT EXISTS idx_bess_dispatch_lookup ON public.bess_dispatch_schedules(organization_id, asset_id, delivery_date);

-- 7. Add columns to existing tables
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS supply_contract_id uuid REFERENCES public.supply_contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shape_key text NOT NULL DEFAULT 'baseload',
  ADD COLUMN IF NOT EXISTS shape_hours numeric[];

ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_shape_key_chk;
ALTER TABLE public.trades
  ADD CONSTRAINT trades_shape_key_chk CHECK (
    shape_key IN ('baseload','peak_08_20','offpeak','night_00_06','day_09_16','solar_shape','wind_shape','custom')
  );

ALTER TABLE public.lead_quotes
  ADD COLUMN IF NOT EXISTS profile_key text REFERENCES public.profile_capture_factors(profile_key),
  ADD COLUMN IF NOT EXISTS capture_factor numeric,
  ADD COLUMN IF NOT EXISTS captured_price_eur_mwh numeric,
  ADD COLUMN IF NOT EXISTS volume_risk_premium_eur_mwh numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_price_eur_mwh numeric,
  ADD COLUMN IF NOT EXISTS risk_capacity_ok boolean DEFAULT true;

-- 8. SQL Functions
CREATE OR REPLACE FUNCTION public.shape_mask(p_key text, p_hours numeric[])
RETURNS numeric[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_key
    WHEN 'baseload'    THEN array_fill(1::numeric, ARRAY[24])
    WHEN 'peak_08_20'  THEN (SELECT array_agg(CASE WHEN h BETWEEN 8 AND 19 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'offpeak'     THEN (SELECT array_agg(CASE WHEN h < 8 OR h >= 20 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'night_00_06' THEN (SELECT array_agg(CASE WHEN h < 6 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'day_09_16'   THEN (SELECT array_agg(CASE WHEN h BETWEEN 9 AND 15 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'solar_shape' THEN (SELECT array_agg(CASE WHEN h BETWEEN 6 AND 18 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    -- FIX 2: original had "THEN 1 ELSE 0.5 ELSE 0" (two ELSE — syntax error).
    -- Resolved to: full weight 02-06 and 18-23 (wind hours), half weight otherwise.
    WHEN 'wind_shape'  THEN (SELECT array_agg(CASE WHEN h BETWEEN 2 AND 6 OR h BETWEEN 18 AND 23 THEN 1 ELSE 0.5 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'custom'      THEN p_hours
  END;
$$;

CREATE OR REPLACE VIEW public.v_hourly_position AS
WITH hrs AS (SELECT generate_series(0,23) AS h),
org_filter AS (SELECT public.current_org_id() AS oid),
sold AS (
  SELECT sc.id AS supply_contract_id, d::date AS delivery_date, hrs.h AS hour_of_day,
         (sc.annual_volume_mwh / 365.0) * (1.0/24) AS mwh
  FROM public.supply_contracts sc
  CROSS JOIN org_filter
  CROSS JOIN LATERAL generate_series(sc.start_date, COALESCE(sc.end_date, sc.start_date + interval '1 year'), '1 day') d
  CROSS JOIN hrs
  WHERE sc.status = 'active' AND sc.organization_id = org_filter.oid
),
bought AS (
  SELECT t.supply_contract_id, d::date AS delivery_date, hrs.h AS hour_of_day,
         CASE WHEN t.side ILIKE 'buy%' THEN 1 ELSE -1 END
           * t.volume_mwh * (public.shape_mask(t.shape_key, t.shape_hours))[hrs.h + 1]
           / NULLIF((SELECT SUM(x) FROM unnest(public.shape_mask(t.shape_key, t.shape_hours)) x), 0)
           / GREATEST((t.delivery_end::date - t.delivery_start::date), 1) AS mwh
  FROM public.trades t
  CROSS JOIN org_filter
  CROSS JOIN LATERAL generate_series(t.delivery_start::date, t.delivery_end::date - 1, '1 day') d
  CROSS JOIN hrs
  WHERE t.status IN ('confirmed','settled','executed') AND t.organization_id = org_filter.oid
)
SELECT COALESCE(s.delivery_date, b.delivery_date) AS delivery_date,
       COALESCE(s.hour_of_day, b.hour_of_day) AS hour_of_day,
       COALESCE(SUM(s.mwh), 0) AS sold_mwh,
       COALESCE(SUM(b.mwh), 0) AS bought_mwh,
       COALESCE(SUM(s.mwh), 0) - COALESCE(SUM(b.mwh), 0) AS open_mwh
FROM sold s
FULL OUTER JOIN bought b ON s.delivery_date = b.delivery_date AND s.hour_of_day = b.hour_of_day AND s.supply_contract_id IS NOT DISTINCT FROM b.supply_contract_id
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.v_hedge_breaches AS
SELECT delivery_date, MAX(ABS(open_mwh)) AS worst_open_mwh,
       (array_agg(hour_of_day ORDER BY ABS(open_mwh) DESC))[1] AS worst_hour,
       SUM(open_mwh) AS net_open_mwh,
       CASE WHEN SUM(sold_mwh) > 0 THEN SUM(bought_mwh) / SUM(sold_mwh) END AS hedge_ratio,
       SUM(CASE WHEN open_mwh > 0.001 THEN open_mwh ELSE 0 END) AS total_short_mwh,
       SUM(CASE WHEN open_mwh < -0.001 THEN ABS(open_mwh) ELSE 0 END) AS total_long_mwh
FROM public.v_hourly_position
GROUP BY delivery_date
HAVING MAX(ABS(open_mwh)) > 0.001
ORDER BY delivery_date;

-- 9. Backfill existing data
UPDATE public.trades SET shape_key = 'baseload' WHERE shape_key IS NULL OR shape_key = '';

UPDATE public.trades t
SET supply_contract_id = sc.id
FROM public.supply_contracts sc
WHERE t.side ILIKE 'buy%'
  AND t.supply_contract_id IS NULL
  AND sc.status = 'active'
  AND t.delivery_start <= COALESCE(sc.end_date, sc.start_date + interval '1 year')
  AND t.delivery_end >= sc.start_date
  AND t.organization_id = sc.organization_id;
