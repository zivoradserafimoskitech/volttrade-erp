-- sync-kimi-meters upserts with onConflict (metering_point_id, reading_at),
-- but meter_readings has no matching unique constraint -> Postgres rejects
-- the ON CONFLICT clause. Dedup existing rows, then add the index.
DELETE FROM public.meter_readings a
USING public.meter_readings b
WHERE a.metering_point_id = b.metering_point_id
  AND a.reading_at = b.reading_at
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_mp_reading_at_unique
  ON public.meter_readings (metering_point_id, reading_at);
