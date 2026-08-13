-- PV forecasting, corrected for the consolidated metering_points table.
-- Supersedes 20260720130000_pv_forecasts.sql, which targeted the retired
-- public.connection_points relation.
ALTER TABLE public.metering_points
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS pv_tilt_deg numeric DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pv_azimuth_deg numeric DEFAULT 180,  -- 180 = south
  ADD COLUMN IF NOT EXISTS pv_calibration numeric NOT NULL DEFAULT 1.0;

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

GRANT SELECT ON public.pv_forecasts TO authenticated;
GRANT ALL ON public.pv_forecasts TO service_role;

ALTER TABLE public.pv_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read pv_forecasts" ON public.pv_forecasts;
CREATE POLICY "staff read pv_forecasts" ON public.pv_forecasts
  FOR SELECT TO authenticated USING (public.is_staff());

CREATE INDEX IF NOT EXISTS idx_pv_forecasts_ts ON public.pv_forecasts(ts);