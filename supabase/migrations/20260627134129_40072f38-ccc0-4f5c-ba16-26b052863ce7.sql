ALTER TABLE public.metering_points
  ADD COLUMN has_pv boolean NOT NULL DEFAULT false,
  ADD COLUMN pv_capacity_kw numeric;

GRANT SELECT, INSERT, UPDATE ON public.metering_points TO authenticated;
GRANT ALL ON public.metering_points TO service_role;