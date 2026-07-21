-- ═══════════════════════════════════════════════════════════════════
-- Access model fix for core business tables.
--
-- The original "auth.uid() = user_id" model means only the ONE staff
-- member who created a client can see it — colleagues can't. That is a
-- functional bug (fragmented data) dressed as security. Correct model:
--   • STAFF (any app_role): see/manage ALL business records — this is a
--     back office; a trader must see clients a billing officer created.
--   • PORTAL consumers (no role, linked via clients.portal_user_id):
--     see ONLY their own client + its metering points, readings, invoices.
--   • Destructive ops (delete) restricted to admin/management.
-- ═══════════════════════════════════════════════════════════════════

-- ── clients ──
DROP POLICY IF EXISTS "own clients select" ON public.clients;
DROP POLICY IF EXISTS "own clients insert" ON public.clients;
DROP POLICY IF EXISTS "own clients update" ON public.clients;
DROP POLICY IF EXISTS "own clients delete" ON public.clients;

CREATE POLICY "staff read clients" ON public.clients FOR SELECT TO authenticated
  USING (public.is_staff() OR portal_user_id = auth.uid());
CREATE POLICY "staff insert clients" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader']::public.app_role[]));
CREATE POLICY "staff update clients" ON public.clients FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','billing_officer']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','billing_officer']::public.app_role[]));
CREATE POLICY "admin delete clients" ON public.clients FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]));

-- ── metering_points ── (staff all; portal via owning client)
DROP POLICY IF EXISTS "own meters select" ON public.metering_points;
DROP POLICY IF EXISTS "own meters insert" ON public.metering_points;
DROP POLICY IF EXISTS "own meters update" ON public.metering_points;
DROP POLICY IF EXISTS "own meters delete" ON public.metering_points;

CREATE POLICY "staff or owner read mp" ON public.metering_points FOR SELECT TO authenticated
  USING (public.is_staff() OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.portal_user_id = auth.uid()));
CREATE POLICY "staff write mp" ON public.metering_points FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::public.app_role[]));
CREATE POLICY "staff update mp" ON public.metering_points FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::public.app_role[]));
CREATE POLICY "admin delete mp" ON public.metering_points FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]));

-- ── consumption_readings ── (staff all; portal read own via metering point)
DROP POLICY IF EXISTS "own consumption select" ON public.consumption_readings;
DROP POLICY IF EXISTS "own readings select" ON public.consumption_readings;

CREATE POLICY "staff or owner read consumption" ON public.consumption_readings FOR SELECT TO authenticated
  USING (public.is_staff() OR EXISTS (
    SELECT 1 FROM public.metering_points m JOIN public.clients c ON c.id = m.client_id
    WHERE m.id = metering_point_id AND c.portal_user_id = auth.uid()));
CREATE POLICY "staff write consumption" ON public.consumption_readings FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "staff update consumption" ON public.consumption_readings FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── meter_readings ── (registers: staff manage; portal read own)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='meter_readings') THEN
    EXECUTE 'ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "own meter_readings select" ON public.meter_readings';
    EXECUTE 'DROP POLICY IF EXISTS "staff read meter_readings" ON public.meter_readings';
    EXECUTE 'DROP POLICY IF EXISTS "staff write meter_readings" ON public.meter_readings';
    EXECUTE $p$CREATE POLICY "staff or owner read meter_readings" ON public.meter_readings FOR SELECT TO authenticated
      USING (public.is_staff() OR EXISTS (
        SELECT 1 FROM public.metering_points m JOIN public.clients c ON c.id = m.client_id
        WHERE m.id = metering_point_id AND c.portal_user_id = auth.uid()))$p$;
    EXECUTE $p$CREATE POLICY "staff write meter_readings" ON public.meter_readings FOR ALL TO authenticated
      USING (public.is_staff()) WITH CHECK (public.is_staff())$p$;
  END IF;
END $$;

-- ── invoices ── keep portal read-own; ensure staff scoping is role-based
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "invoices all" ON public.invoices';
  EXECUTE $p$CREATE POLICY "staff read invoices" ON public.invoices FOR SELECT TO authenticated
    USING (public.is_staff() OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.portal_user_id = auth.uid()))$p$;
  EXECUTE $p$CREATE POLICY "billing write invoices" ON public.invoices FOR ALL TO authenticated
    USING (public.has_any_role(auth.uid(), ARRAY['admin','management','billing_officer','finance']::public.app_role[]))
    WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','billing_officer','finance']::public.app_role[]))$p$;
EXCEPTION WHEN others THEN NULL; -- if invoice policies differ, leave existing portal policy intact
END $$;
