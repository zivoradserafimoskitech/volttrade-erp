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
  ADD COLUMN IF NOT EXISTS metering_point_id uuid REFERENCES public.metering_points(id) ON DELETE CASCADE;

-- REPAIR 2026-09-01: connection_point_id only exists on databases migrated
-- before the pv_forecasts repair. Guard it so a from-scratch rebuild works.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='pv_forecasts'
               AND column_name='connection_point_id') THEN
    EXECUTE 'ALTER TABLE public.pv_forecasts ALTER COLUMN connection_point_id DROP NOT NULL';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS pv_forecasts_mp_ts_unique
  ON public.pv_forecasts (metering_point_id, ts) WHERE metering_point_id IS NOT NULL;
