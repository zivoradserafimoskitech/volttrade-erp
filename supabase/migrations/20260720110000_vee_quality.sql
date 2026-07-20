-- VEE (validation-estimation-editing) support.
-- consumption_readings.quality: measured | estimated | flagged
ALTER TABLE public.consumption_readings
  ADD COLUMN IF NOT EXISTS quality text NOT NULL DEFAULT 'measured'
  CHECK (quality IN ('measured','estimated','flagged'));

CREATE INDEX IF NOT EXISTS idx_meter_readings_pending
  ON public.meter_readings (metering_point_id, reading_at)
  WHERE validation_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_consumption_readings_quality
  ON public.consumption_readings (quality)
  WHERE quality <> 'measured';
