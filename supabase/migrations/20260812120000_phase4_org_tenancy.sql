-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 4 — ORGANIZATION TENANCY (audit P0-3)
--
-- THE PROBLEM
-- -----------
-- Two contradictory ownership models have been live simultaneously:
--
--   1. The original Lovable model: every table carries
--      `user_id uuid NOT NULL REFERENCES auth.users`, with policies reading
--      `USING (auth.uid() = user_id)`. Records belong to ONE HUMAN.
--   2. The later staff-role model: is_staff(), has_any_role(), nine app_roles.
--      Records belong to THE COMPANY.
--
-- 45 live policies across 26 tables still use model 1. The consequences are
-- not theoretical:
--
--   * A metering point created by Ana is invisible to a query run as Bojan.
--   * Every scheduled sync that filtered `.eq("user_id", user.id)` broke,
--     because pg_cron has no user (fixed case-by-case in Phases 1–3;
--     sync-influx-forecasts is STILL blocked on this migration).
--   * Deleting a staff account cascaded into their invoices (Phase 1 changed
--     that to SET NULL as a stopgap).
--
-- THE FIX
-- -------
-- `organization_id` becomes the ownership key. `user_id` is RENAMED to
-- `created_by` — deliberately, so that any code still filtering by ownership
-- through user_id FAILS LOUDLY instead of silently returning an empty set. In
-- a billing system a silent empty result is far more dangerous than an error.
--
-- Genuinely per-person tables (user_roles, notifications, device_tokens,
-- notification_preferences, consumer_applications) are LEFT ALONE — there
-- user_id correctly means "this human", not "this company".
--
-- ORDER MATTERS. Read the sections top to bottom before running.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Organizations and membership
-- ───────────────────────────────────────────────────────────────────────────

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

ALTER TABLE public.organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organizations IS
  'The tenant. Owns every operational record via <table>.organization_id. '
  'Replaces the original per-user ownership model.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Seed the tenant and enrol every existing staff user
--
-- Single-tenant today. The point is not multi-tenancy for its own sake — it is
-- that ownership stops being tied to an individual's account.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO public.organizations (id, name, legal_name, country_code)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'Vatra', 'Vatra', 'MK'
WHERE NOT EXISTS (SELECT 1 FROM public.organizations);

-- Everyone who holds a staff role, plus everyone who already owns data.
INSERT INTO public.organization_members (organization_id, user_id)
SELECT (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1), u.id
FROM auth.users u
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
ON CONFLICT DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Helpers
--
-- STABLE + SECURITY DEFINER with a pinned search_path, as every other helper
-- in this database. current_org_id() is what RLS and column defaults call, so
-- it must be cheap — it is a single indexed lookup and Postgres caches it per
-- statement.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
  ORDER BY is_default DESC, created_at
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid() AND organization_id = p_org
  )
$$;

GRANT EXECUTE ON FUNCTION public.current_org_id()      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid)   TO authenticated, service_role;

CREATE POLICY "members read their organization"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));

CREATE POLICY "members read their membership"
  ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Add organization_id, backfill, and rename user_id -> created_by
--
-- Driven by a table list rather than 21 hand-written blocks, so the set is
-- auditable in one place and cannot drift.
--
-- NOT in this list (person-scoped, correctly): user_roles, notifications,
-- notification_preferences, device_tokens, consumer_applications.
-- ───────────────────────────────────────────────────────────────────────────

-- 4a. DROP LEGACY OWNERSHIP POLICIES *BEFORE* THE RENAME.
--
--     ORDERING HAZARD — this must not be moved below section 4b.
--     ALTER TABLE ... RENAME COLUMN rewrites dependent policy expressions
--     automatically, because Postgres stores them as parse trees keyed on
--     attnum, not as text. So AFTER the rename these policies render as
--     `auth.uid() = created_by` and a search for `user_id` matches nothing —
--     every legacy restrictive policy would silently survive and keep
--     blocking access, with the migration reporting success.
--
--     The matcher below therefore checks BOTH names, so this block is also
--     safe to re-run after a partial application.

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND (qual       ~* 'auth\\.uid\\(\\) = (user_id|created_by)|(user_id|created_by) = auth\\.uid\\(\\)'
        OR with_check ~* 'auth\\.uid\\(\\) = (user_id|created_by)|(user_id|created_by) = auth\\.uid\\(\\)')
      AND tablename NOT IN (
        'user_roles','notifications','notification_preferences',
        'device_tokens','consumer_applications','organization_members')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
    RAISE NOTICE 'dropped legacy ownership policy %.%', p.tablename, p.policyname;
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
  t          text;
  v_org      uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;

  FOREACH t IN ARRAY org_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=t
    ) THEN
      RAISE NOTICE 'skipping % (table not present)', t;
      CONTINUE;
    END IF;

    -- 4a. organization_id
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id)', t);
    EXECUTE format('UPDATE public.%I SET organization_id = %L WHERE organization_id IS NULL', t, v_org);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT public.current_org_id()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organization_id)', 'idx_'||t||'_org', t);

    -- 4b. user_id -> created_by. Renamed, not dropped: "who made this" is
    --     genuinely useful in an audit. But it no longer governs visibility.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='user_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='created_by'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN user_id TO created_by', t);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by DROP NOT NULL', t);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by SET DEFAULT auth.uid()', t);

      -- Re-point the FK at ON DELETE SET NULL if Phase 1 has not already.
      DECLARE con text;
      BEGIN
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
          EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (created_by) '
            'REFERENCES auth.users(id) ON DELETE SET NULL', t, t||'_created_by_fkey');
        END LOOP;
      END;
    END IF;

    RAISE NOTICE 'migrated %', t;
  END LOOP;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Rewrite ownership policies onto organization_id
--
-- Drops every policy whose qualifier was `auth.uid() = user_id` and replaces
-- it with org membership plus the existing role gates. Role checks are
-- unchanged — this migration changes WHO OWNS a row, not WHO MAY DO WHAT.
-- ───────────────────────────────────────────────────────────────────────────

-- Staff of the owning organization may read; writes stay gated by the same
-- role sets the hardening migration established.
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
    EXECUTE format(
      'CREATE POLICY "org staff read %s" ON public.%I FOR SELECT TO authenticated '
      'USING (public.is_staff() AND organization_id = public.current_org_id())', t, t);

    EXECUTE format('DROP POLICY IF EXISTS "org staff write %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "org staff write %s" ON public.%I FOR ALL TO authenticated '
      'USING (public.is_staff() AND organization_id = public.current_org_id()) '
      'WITH CHECK (public.is_staff() AND organization_id = public.current_org_id())', t, t);
  END LOOP;
END $$;

-- invoices is deliberately excluded from the loop above: Phase 2 removed its
-- INSERT policy so that only the billing-run edge function (service_role) can
-- create invoices. Preserve that, and scope reads/updates to the org.
DROP POLICY IF EXISTS "org staff read invoices" ON public.invoices;
CREATE POLICY "org staff read invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_staff() AND organization_id = public.current_org_id());

DROP POLICY IF EXISTS "billing update invoices" ON public.invoices;
CREATE POLICY "billing update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND public.has_any_role(auth.uid(),
      ARRAY['admin','management','billing_officer','finance']::public.app_role[]))
  WITH CHECK (
    organization_id = public.current_org_id()
    AND public.has_any_role(auth.uid(),
      ARRAY['admin','management','billing_officer','finance']::public.app_role[]));


-- ───────────────────────────────────────────────────────────────────────────
-- 5b. RE-KEY UNIQUE CONSTRAINTS THAT INCLUDED user_id
--
-- Renaming user_id -> created_by silently carries these along, which breaks
-- them in a way that is easy to miss:
--
--   forecasts: UNIQUE (user_id, client_id, forecast_date)
--     becomes UNIQUE (created_by, client_id, forecast_date). created_by is now
--     NULLABLE, and in Postgres NULLs are distinct in a unique index — so a
--     scheduled sync (created_by = NULL) could insert UNLIMITED duplicate
--     forecast rows for the same client and date, and the upsert path that
--     relies on this key would stop deduplicating.
--
--   assets: UNIQUE (user_id, asset_code) becomes UNIQUE (created_by,
--     asset_code) — so two staff members could each create an asset with the
--     same code, and gateway_device_id linking would become ambiguous.
--
-- Both must be re-keyed to organization_id, which is NOT NULL.
--
-- user_roles UNIQUE (user_id, role) and consumer_applications' partial unique
-- index are correctly person-scoped and are left alone.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  con text;
BEGIN
  -- forecasts
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='forecasts') THEN
    FOR con IN
      SELECT c.conname FROM pg_constraint c
      JOIN pg_class rel ON rel.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
      WHERE n.nspname='public' AND rel.relname='forecasts' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) ILIKE '%created_by%'
    LOOP
      EXECUTE format('ALTER TABLE public.forecasts DROP CONSTRAINT %I', con);
    END LOOP;
    -- Collapse any duplicates the old key allowed before enforcing the new one.
    DELETE FROM public.forecasts f USING public.forecasts g
     WHERE f.organization_id = g.organization_id
       AND f.client_id       = g.client_id
       AND f.forecast_date   = g.forecast_date
       AND f.ctid > g.ctid;
    ALTER TABLE public.forecasts
      ADD CONSTRAINT forecasts_org_client_date_key
      UNIQUE (organization_id, client_id, forecast_date);
  END IF;

  -- assets
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='assets') THEN
    FOR con IN
      SELECT c.conname FROM pg_constraint c
      JOIN pg_class rel ON rel.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
      WHERE n.nspname='public' AND rel.relname='assets' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) ILIKE '%created_by%'
    LOOP
      EXECUTE format('ALTER TABLE public.assets DROP CONSTRAINT %I', con);
    END LOOP;
    ALTER TABLE public.assets
      ADD CONSTRAINT assets_org_code_key UNIQUE (organization_id, asset_code);
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. Child tables inherit scope through their parent
--
-- consumption_readings, meter_readings, metering_points, supply_contract_points,
-- schedule_lines and payment_allocations had no user_id of their own — their
-- policies reached the owner through a join. Re-point those joins at the
-- parent's organization_id.
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff or owner read mp" ON public.metering_points;
DROP POLICY IF EXISTS "org staff read metering_points" ON public.metering_points;
CREATE POLICY "org staff read metering_points" ON public.metering_points
  FOR SELECT TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = metering_points.client_id
      AND c.organization_id = public.current_org_id()));

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
    WHERE s.id = schedule_lines.schedule_id
      AND s.organization_id = public.current_org_id()))
  WITH CHECK (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_lines.schedule_id
      AND s.organization_id = public.current_org_id()));

DROP POLICY IF EXISTS "alloc all" ON public.payment_allocations;
DROP POLICY IF EXISTS "org staff payment_allocations" ON public.payment_allocations;
CREATE POLICY "org staff payment_allocations" ON public.payment_allocations
  FOR ALL TO authenticated
  USING (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = payment_allocations.payment_id
      AND p.organization_id = public.current_org_id()))
  WITH CHECK (public.is_staff() AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = payment_allocations.payment_id
      AND p.organization_id = public.current_org_id()));

-- audit_log: the actor stays user_id (that is its correct meaning), but reads
-- become org-scoped instead of "only your own actions" — an audit trail nobody
-- but the actor can read is not an audit trail.
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
UPDATE public.audit_log SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.audit_log ALTER COLUMN organization_id SET DEFAULT public.current_org_id();

DROP POLICY IF EXISTS "audit read" ON public.audit_log;
CREATE POLICY "org admin read audit" ON public.audit_log
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
     AND public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]));


-- ───────────────────────────────────────────────────────────────────────────
-- 7. PORTAL CONSUMERS ARE UNTOUCHED
--
-- Portal policies key on clients.portal_user_id, not user_id, so none of them
-- appeared in the rewrite above. Restated here so a future reader does not
-- assume portal access was folded into org membership — a portal consumer must
-- NEVER be an organization member.
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.clients.portal_user_id IS
  'Portal consumer login. NOT an organization member: portal access is granted '
  'per client record via the portal policies, and org membership is staff-only.';


-- ───────────────────────────────────────────────────────────────────────────
-- 8. Verification — run these after applying
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  leftover int;
BEGIN
  SELECT count(*) INTO leftover
  FROM pg_policies
  WHERE schemaname='public'
    AND qual ~* 'auth\.uid\(\) = (user_id|created_by)|(user_id|created_by) = auth\.uid\(\)'
    AND tablename NOT IN (
      'user_roles','notifications','notification_preferences',
      'device_tokens','consumer_applications','organization_members');
  IF leftover > 0 THEN
    RAISE WARNING
      '% policy/policies still key on per-user ownership outside the allowed '
      'person-scoped tables. Inspect: SELECT tablename, policyname FROM '
      'pg_policies WHERE qual ILIKE ''%%auth.uid() = user_id%%'';', leftover;
  ELSE
    RAISE NOTICE 'OK: no legacy per-user ownership policies remain.';
  END IF;
END $$;
