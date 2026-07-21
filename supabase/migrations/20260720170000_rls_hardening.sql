-- ═══════════════════════════════════════════════════════════════════
-- RLS HARDENING — replace permissive USING(true) policies with
-- role-based access. Principle: authenticated ≠ authorized.
--
-- Roles (app_role): admin, management, trader, supply_manager,
--   billing_officer, finance, risk_officer, operations, auditor.
-- Portal consumers are authenticated users WITHOUT any staff role —
-- they must never reach internal tables (they have their own scoped
-- policies via current_portal_client_id() elsewhere).
-- ═══════════════════════════════════════════════════════════════════

-- Any internal staff member (has at least one app_role). Portal-only
-- users return false here → blocked from all internal tables below.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) $$;

GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- Helper: does the current user hold any of these roles?
-- (has_any_role already exists; we lean on it below.)

-- ── Reference data: readable by any staff, writable only by admin ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['market_prices','countries','slp_profiles','slp_curve_points',
                           'slp_coefficients','regulatory_charges','public_holidays','external_api_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- drop known permissive policies (names vary; ignore if absent)
    EXECUTE format('DROP POLICY IF EXISTS "prices read" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "prices insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "countries read" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth read %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "auth read api log" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "service write api log" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "slp_profiles_read_all" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "slp_curve_points_read_all" ON public.%I', t);
  END LOOP;
END $$;

CREATE POLICY "staff read market_prices"   ON public.market_prices   FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff read countries"       ON public.countries       FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff read slp_profiles"    ON public.slp_profiles    FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff read slp_curve_points" ON public.slp_curve_points FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff read slp_coefficients" ON public.slp_coefficients FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff read regulatory_charges" ON public.regulatory_charges FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff read public_holidays" ON public.public_holidays FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff read external_api_log" ON public.external_api_log FOR SELECT TO authenticated USING (public.is_staff());

-- Writes to reference/market data: trading & admin only
CREATE POLICY "trader write market_prices" ON public.market_prices FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','trader','management']::public.app_role[]));
CREATE POLICY "log insert" ON public.external_api_log FOR INSERT TO authenticated WITH CHECK (public.is_staff());

-- ── Balancing tables: staff read; balancing roles write ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['balance_groups','balance_schedules','settlements','volume_forecasts','pv_forecasts']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth read %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "auth write %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "auth insert %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "service write %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "staff read %s" ON public.%I FOR SELECT TO authenticated USING (public.is_staff())', t, t);
  END LOOP;
END $$;

-- Write access for balancing: trader, supply_manager, operations, admin, management
CREATE POLICY "bal write balance_groups"    ON public.balance_groups    FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader','operations']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader','operations']::public.app_role[]));
CREATE POLICY "bal write balance_schedules" ON public.balance_schedules FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader','operations']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader','operations']::public.app_role[]));
CREATE POLICY "bal write settlements"       ON public.settlements       FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader','risk_officer']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader','risk_officer']::public.app_role[]));
CREATE POLICY "bal insert volume_forecasts" ON public.volume_forecasts FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "bal write pv_forecasts"      ON public.pv_forecasts      FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader','operations']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader','operations']::public.app_role[]));

-- ── connection_points is retired (consolidated to metering_points) but if it
--    still exists, lock it to staff to avoid a lingering open table ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='connection_points') THEN
    EXECUTE 'DROP POLICY IF EXISTS "auth read connection_points" ON public.connection_points';
    EXECUTE 'DROP POLICY IF EXISTS "auth write connection_points" ON public.connection_points';
    EXECUTE 'CREATE POLICY "staff connection_points" ON public.connection_points FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())';
  END IF;
END $$;
