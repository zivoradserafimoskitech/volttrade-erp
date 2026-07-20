-- Consolidation: metering_points (managed by Supply Points + Consumer Manager)
-- is THE connection-point table. connection_points was a parallel, never-
-- populated table — analytics now read metering_points. PV forecast fields
-- move here; pv_forecasts gets a metering_point key.
ALTER TABLE public.metering_points
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS pv_tilt_deg numeric DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pv_azimuth_deg numeric DEFAULT 180,
  ADD COLUMN IF NOT EXISTS pv_calibration numeric NOT NULL DEFAULT 1.0;

ALTER TABLE public.pv_forecasts
  ADD COLUMN IF NOT EXISTS metering_point_id uuid REFERENCES public.metering_points(id) ON DELETE CASCADE,
  ALTER COLUMN connection_point_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pv_forecasts_mp_ts_unique
  ON public.pv_forecasts (metering_point_id, ts) WHERE metering_point_id IS NOT NULL;
