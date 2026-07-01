-- Collapse connection_points into metering_points
ALTER TABLE public.metering_points
  ADD COLUMN IF NOT EXISTS metering_category public.metering_category,
  ADD COLUMN IF NOT EXISTS slp_category public.slp_category,
  ADD COLUMN IF NOT EXISTS consumer_type public.consumer_type,
  ADD COLUMN IF NOT EXISTS is_prosumer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prosumer_scheme public.prosumer_scheme,
  ADD COLUMN IF NOT EXISTS has_private_meter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eic_metering_id text,
  ADD COLUMN IF NOT EXISTS dso_meter_id text,
  ADD COLUMN IF NOT EXISTS tariff_type text,
  ADD COLUMN IF NOT EXISTS balance_group_id uuid REFERENCES public.balance_groups(id) ON DELETE SET NULL;

-- Derive metering_category from existing consumer_category where missing
UPDATE public.metering_points
   SET metering_category = CASE
     WHEN consumer_category = 'slp' THEN 'PROFILED'::public.metering_category
     ELSE 'MEASURED'::public.metering_category
   END
 WHERE metering_category IS NULL;

-- Copy any orphan connection_points rows onto matching metering_points via eic/dso/meter id
UPDATE public.metering_points mp
   SET metering_category = COALESCE(mp.metering_category, cp.metering_category),
       slp_category      = COALESCE(mp.slp_category, cp.slp_category),
       consumer_type     = COALESCE(mp.consumer_type, cp.consumer_type),
       is_prosumer       = mp.is_prosumer OR cp.is_prosumer,
       prosumer_scheme   = COALESCE(mp.prosumer_scheme, cp.prosumer_scheme),
       has_private_meter = mp.has_private_meter OR cp.has_private_meter,
       eic_metering_id   = COALESCE(mp.eic_metering_id, cp.eic_metering_id),
       dso_meter_id      = COALESCE(mp.dso_meter_id, cp.dso_meter_id),
       tariff_type       = COALESCE(mp.tariff_type, cp.tariff_type),
       balance_group_id  = COALESCE(mp.balance_group_id, cp.balance_group_id)
  FROM public.connection_points cp
 WHERE cp.metering_point_id = mp.id
    OR (cp.eic_metering_id IS NOT NULL AND cp.eic_metering_id = mp.edu_code)
    OR (cp.dso_meter_id    IS NOT NULL AND cp.dso_meter_id    = mp.meter_id);

DROP TABLE IF EXISTS public.connection_points CASCADE;