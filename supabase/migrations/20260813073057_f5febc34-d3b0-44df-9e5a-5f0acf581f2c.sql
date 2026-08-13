CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  legal_name  text,
  tax_id      text,
  country_code text REFERENCES public.countries(code),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_default      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members (user_id);

GRANT SELECT ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;

ALTER TABLE public.organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organizations IS
  'The tenant. Owns every operational record via <table>.organization_id.';

INSERT INTO public.organizations (id, name, legal_name, country_code)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'Vatra', 'Vatra', 'MK'
WHERE NOT EXISTS (SELECT 1 FROM public.organizations);

INSERT INTO public.organization_members (organization_id, user_id)
SELECT (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1), u.id
FROM auth.users u
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role <> 'customer'::public.app_role)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT organization_id FROM public.organization_members
  WHERE user_id = auth.uid()
  ORDER BY is_default DESC, created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid() AND organization_id = p_org)
$$;

REVOKE ALL ON FUNCTION public.current_org_id() FROM public, anon;
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_org_id()    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "members read their organization" ON public.organizations;
CREATE POLICY "members read their organization"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));

DROP POLICY IF EXISTS "members read their membership" ON public.organization_members;
CREATE POLICY "members read their membership"
  ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname='public'
      AND (qual ~* 'auth\.uid\(\) = (user_id|created_by)|(user_id|created_by) = auth\.uid\(\)'
        OR with_check ~* 'auth\.uid\(\) = (user_id|created_by)|(user_id|created_by) = auth\.uid\(\)')
      AND tablename NOT IN ('user_roles','notifications','notification_preferences',
        'device_tokens','consumer_applications','organization_members')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  org_tables text[] := ARRAY[
    'assets','asset_dispatch_schedules','asset_telemetry','asset_telemetry_latest',
    'billing_runs','clients','counterparties','forecasts','invoices','leads',
    'nominations','payments','ppa_agreements','schedules','sites',
    'supply_contracts','switch_requests','tariffs','trades','trading_contracts'
  ];
  t text; v_org uuid; con text;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  FOREACH t IN ARRAY org_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id)', t);
    EXECUTE format('UPDATE public.%I SET organization_id = %L WHERE organization_id IS NULL', t, v_org);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT public.current_org_id()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organization_id)', 'idx_'||t||'_org', t);

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=t AND column_name='user_id')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=t AND column_name='created_by') THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN user_id TO created_by', t);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by DROP NOT NULL', t);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by SET DEFAULT auth.uid()', t);

      FOR con IN
        SELECT c.conname FROM pg_constraint c
        JOIN pg_class rel ON rel.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=rel.relnamespace
        WHERE n.nspname='public' AND rel.relname=t AND c.contype='f'
          AND pg_get_constraintdef(c.oid) ILIKE '%auth.users%'
          AND pg_get_constraintdef(c.oid) ILIKE '%created_by%'
          AND pg_get_constraintdef(c.oid) NOT ILIKE '%SET NULL%'
      LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, con);
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL', t, t||'_created_by_fkey');
      END LOOP;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  org_tables text[] := ARRAY[
    'assets','asset_dispatch_schedules','asset_telemetry','asset_telemetry_latest',
    'billing_runs','clients','counterparties','forecasts','leads',
    'nominations','payments','ppa_agreements','schedules','sites',
    'supply_contracts','switch_requests','tariffs','trades','trading_contracts'
  ];
BEGIN
  FOREACH t IN ARRAY org_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS "org staff read %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "org staff read %s" ON public.%I FOR SELECT TO authenticated USING (public.is_staff() AND organization_id = public.current_org_id())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "org staff write %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "org staff write %s" ON public.%I FOR ALL TO authenticated USING (public.is_staff() AND organization_id = public.current_org_id()) WITH CHECK (public.is_staff() AND organization_id = public.current_org_id())', t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "org staff read invoices" ON public.invoices;
CREATE POLICY "org staff read invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_staff() AND organization_id = public.current_org_id());

DROP POLICY IF EXISTS "billing update invoices" ON public.invoices;
CREATE POLICY "billing update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (organization_id = public.current_org_id()
    AND public.has_any_role(auth.uid(), ARRAY['admin','management','billing_officer','finance']::public.app_role[]))
  WITH CHECK (organization_id = public.current_org_id()
    AND public.has_any_role(auth.uid(), ARRAY['admin','management','billing_officer','finance']::public.app_role[]));

DO $$
DECLARE con text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='forecasts') THEN
    FOR con IN
      SELECT c.conname FROM pg_constraint c
      JOIN pg_class rel ON rel.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
      WHERE n.nspname='public' AND rel.relname='forecasts' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) ILIKE '%created_by%'
    LOOP
      EXECUTE format('ALTER TABLE public.forecasts DROP CONSTRAINT %I', con);
    END LOOP;
    DELETE FROM public.forecasts f USING public.forecasts g
     WHERE f.organization_id = g.organization_id
       AND f.client_id = g.client_id
       AND f.forecast_date = g.forecast_date
       AND f.ctid > g.ctid;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='forecasts_org_client_date_key') THEN
      ALTER TABLE public.forecasts ADD CONSTRAINT forecasts_org_client_date_key UNIQUE (organization_id, client_id, forecast_date);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='assets') THEN
    FOR con IN
      SELECT c.conname FROM pg_constraint c
      JOIN pg_class rel ON rel.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
      WHERE n.nspname='public' AND rel.relname='assets' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) ILIKE '%created_by%'
    LOOP
      EXECUTE format('ALTER TABLE public.assets DROP CONSTRAINT %I', con);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assets_org_code_key') THEN
      ALTER TABLE public.assets ADD CONSTRAINT assets_org_code_key UNIQUE (organization_id, asset_code);
    END IF;
  END IF;
END $$;

DROP POLICY IF EXISTS "staff or owner read mp" ON public.metering_points;
DROP POLICY IF EXISTS "org staff read metering_points" ON public.metering_points;
CREATE POLICY "org staff read metering_points" ON public.metering_points
  FOR SELECT TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = metering_points.client_id AND c.organization_id = public.current_org_id()));

DROP POLICY IF EXISTS "staff or owner read consumption" ON public.consumption_readings;
DROP POLICY IF EXISTS "own readings insert" ON public.consumption_readings;
DROP POLICY IF EXISTS "org staff read consumption" ON public.consumption_readings;
CREATE POLICY "org staff read consumption" ON public.consumption_readings
  FOR SELECT TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.metering_points mp
    JOIN public.clients c ON c.id = mp.client_id
    WHERE mp.id = consumption_readings.metering_point_id
      AND c.organization_id = public.current_org_id()));

DROP POLICY IF EXISTS "staff or owner read meter_readings" ON public.meter_readings;
DROP POLICY IF EXISTS "org staff read meter_readings" ON public.meter_readings;
CREATE POLICY "org staff read meter_readings" ON public.meter_readings
  FOR SELECT TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.metering_points mp
    JOIN public.clients c ON c.id = mp.client_id
    WHERE mp.id = meter_readings.metering_point_id
      AND c.organization_id = public.current_org_id()));

DROP POLICY IF EXISTS "supply_contract_points read" ON public.supply_contract_points;
DROP POLICY IF EXISTS "org staff read scp" ON public.supply_contract_points;
CREATE POLICY "org staff read scp" ON public.supply_contract_points
  FOR SELECT TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.supply_contracts sc
    WHERE sc.id = supply_contract_points.contract_id
      AND sc.organization_id = public.current_org_id()));

DROP POLICY IF EXISTS "sl all" ON public.schedule_lines;
DROP POLICY IF EXISTS "org staff schedule_lines" ON public.schedule_lines;
CREATE POLICY "org staff schedule_lines" ON public.schedule_lines
  FOR ALL TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_lines.schedule_id AND s.organization_id = public.current_org_id()))
  WITH CHECK (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_lines.schedule_id AND s.organization_id = public.current_org_id()));

DROP POLICY IF EXISTS "alloc all" ON public.payment_allocations;
DROP POLICY IF EXISTS "org staff payment_allocations" ON public.payment_allocations;
CREATE POLICY "org staff payment_allocations" ON public.payment_allocations
  FOR ALL TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = payment_allocations.payment_id AND p.organization_id = public.current_org_id()))
  WITH CHECK (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = payment_allocations.payment_id AND p.organization_id = public.current_org_id()));

ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
UPDATE public.audit_log SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.audit_log ALTER COLUMN organization_id SET DEFAULT public.current_org_id();

DROP POLICY IF EXISTS "audit read" ON public.audit_log;
DROP POLICY IF EXISTS "org admin read audit" ON public.audit_log;
CREATE POLICY "org admin read audit" ON public.audit_log
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
     AND public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]));

COMMENT ON COLUMN public.clients.portal_user_id IS
  'Portal consumer login. NOT an organization member: portal access is granted per client record.';