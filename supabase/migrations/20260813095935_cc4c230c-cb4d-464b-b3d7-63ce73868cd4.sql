BEGIN;

-- Legacy policies that grant staff access WITHOUT an organization check.
-- They sit alongside the Phase 4 org-scoped policies and override them,
-- because permissive RLS policies are OR'd together.
DROP POLICY IF EXISTS "staff read clients"                 ON public.clients;
DROP POLICY IF EXISTS "staff read invoices"                ON public.invoices;
DROP POLICY IF EXISTS "staff or owner read mp"             ON public.metering_points;
DROP POLICY IF EXISTS "staff or owner read consumption"    ON public.consumption_readings;
DROP POLICY IF EXISTS "staff or owner read meter_readings" ON public.meter_readings;

-- Recreate the org-scoped equivalents, in case Phase 4's versions are absent.
DROP POLICY IF EXISTS "org staff read clients" ON public.clients;
CREATE POLICY "org staff read clients" ON public.clients
  FOR SELECT TO authenticated
  USING (public.is_staff() AND organization_id = public.current_org_id());

DROP POLICY IF EXISTS "org staff read invoices" ON public.invoices;
CREATE POLICY "org staff read invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_staff() AND organization_id = public.current_org_id());

DROP POLICY IF EXISTS "org staff read metering_points" ON public.metering_points;
CREATE POLICY "org staff read metering_points" ON public.metering_points
  FOR SELECT TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = metering_points.client_id
      AND c.organization_id = public.current_org_id()));

DROP POLICY IF EXISTS "org staff read consumption" ON public.consumption_readings;
CREATE POLICY "org staff read consumption" ON public.consumption_readings
  FOR SELECT TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.metering_points mp
    JOIN public.clients c ON c.id = mp.client_id
    WHERE mp.id = consumption_readings.metering_point_id
      AND c.organization_id = public.current_org_id()));

DROP POLICY IF EXISTS "org staff read meter_readings" ON public.meter_readings;
CREATE POLICY "org staff read meter_readings" ON public.meter_readings
  FOR SELECT TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.metering_points mp
    JOIN public.clients c ON c.id = mp.client_id
    WHERE mp.id = meter_readings.metering_point_id
      AND c.organization_id = public.current_org_id()));

COMMIT;