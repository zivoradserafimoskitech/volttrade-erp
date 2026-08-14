BEGIN;

-- volume_forecasts: per-client consumption forecasts.
DROP POLICY IF EXISTS "auth read volume_forecasts"   ON public.volume_forecasts;
DROP POLICY IF EXISTS "auth insert volume_forecasts" ON public.volume_forecasts;
CREATE POLICY "org staff read volume_forecasts" ON public.volume_forecasts
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "bal write volume_forecasts" ON public.volume_forecasts
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','management','operations','trader']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['admin','management','operations','trader']::public.app_role[]));

-- external_api_log: contains operational detail and customer meter codes.
DROP POLICY IF EXISTS "auth read api log"     ON public.external_api_log;
DROP POLICY IF EXISTS "service write api log" ON public.external_api_log;
CREATE POLICY "org staff read api log" ON public.external_api_log
  FOR SELECT TO authenticated USING (public.is_staff());

-- Reference data: staff read, admin write.
DROP POLICY IF EXISTS "auth read regulatory_charges" ON public.regulatory_charges;
CREATE POLICY "staff read regulatory_charges" ON public.regulatory_charges
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "auth read public_holidays" ON public.public_holidays;
CREATE POLICY "staff read public_holidays" ON public.public_holidays
  FOR SELECT TO authenticated USING (public.is_staff());

COMMIT;