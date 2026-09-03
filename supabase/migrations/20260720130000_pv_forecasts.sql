-- PV forecasting: site parameters + hourly forecast storage.
-- Forecast source: third-party weather (Open-Meteo irradiance), converted to
-- AC energy per site and corrected by a per-site calibration factor that is
-- learned from own (Kimi) measurements over time.
--
-- REPAIR 2026-09-01: this migration originally did
--   ALTER TABLE public.connection_points ...
-- and keyed pv_forecasts on connection_points(id). But connection_points is
-- dropped three migrations earlier, in
--   20260701171319_1dacc129-cb94-4e72-822d-931e39932f93.sql:39
--     DROP TABLE IF EXISTS public.connection_points CASCADE;
-- so the file could never apply to a database rebuilt from scratch, and it
-- aborted the chain — taking 20260720150000_consolidate_metering_points.sql
-- and 20260720170000_rls_hardening.sql down with it.
--
-- It now targets public.metering_points directly, which is what
-- 20260813100000_pv_forecasts_corrected.sql later settled on. That file is
-- fully IF NOT EXISTS and becomes a no-op once this one has run. Behaviour on
-- an already-migrated live database is unchanged.

ALTER TABLE public.metering_points
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS pv_tilt_deg numeric DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pv_azimuth_deg numeric DEFAULT 180,  -- 180 = south
  ADD COLUMN IF NOT EXISTS pv_calibration numeric NOT NULL DEFAULT 1.0; -- measured/modelled ratio

CREATE TABLE IF NOT EXISTS public.pv_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metering_point_id uuid NOT NULL REFERENCES public.metering_points(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,            -- hour start (UTC)
  forecast_kwh numeric NOT NULL,
  ghi_wm2 numeric,                    -- raw irradiance from provider, for audit
  temp_c numeric,
  source text NOT NULL DEFAULT 'open-meteo',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metering_point_id, ts)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pv_forecasts TO authenticated;
GRANT ALL ON public.pv_forecasts TO service_role;
ALTER TABLE public.pv_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read pv_forecasts"    ON public.pv_forecasts;
DROP POLICY IF EXISTS "service write pv_forecasts" ON public.pv_forecasts;
CREATE POLICY "auth read pv_forecasts" ON public.pv_forecasts FOR SELECT TO authenticated USING (true);
CREATE POLICY "service write pv_forecasts" ON public.pv_forecasts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_pv_forecasts_ts ON public.pv_forecasts(ts);
