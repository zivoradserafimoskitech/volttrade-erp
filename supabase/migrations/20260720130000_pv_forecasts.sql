-- PV forecasting: site parameters + hourly forecast storage.
-- Forecast source: third-party weather (Open-Meteo irradiance), converted to
-- AC energy per site and corrected by a per-site calibration factor that is
-- learned from own (Kimi) measurements over time.
ALTER TABLE public.connection_points
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS pv_tilt_deg numeric DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pv_azimuth_deg numeric DEFAULT 180,  -- 180 = south
  ADD COLUMN IF NOT EXISTS pv_calibration numeric NOT NULL DEFAULT 1.0; -- measured/modelled ratio

CREATE TABLE IF NOT EXISTS public.pv_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_point_id uuid NOT NULL REFERENCES public.connection_points(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,            -- hour start (UTC)
  forecast_kwh numeric NOT NULL,
  ghi_wm2 numeric,                    -- raw irradiance from provider, for audit
  temp_c numeric,
  source text NOT NULL DEFAULT 'open-meteo',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_point_id, ts)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pv_forecasts TO authenticated;
GRANT ALL ON public.pv_forecasts TO service_role;
ALTER TABLE public.pv_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read pv_forecasts" ON public.pv_forecasts FOR SELECT TO authenticated USING (true);
CREATE POLICY "service write pv_forecasts" ON public.pv_forecasts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_pv_forecasts_ts ON public.pv_forecasts(ts);
