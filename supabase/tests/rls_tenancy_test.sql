-- RLS tenant-isolation integration test.
--
-- WHY THIS EXISTS
-- ---------------
-- src/test/edge-auth.test.ts asserts the *shape* of the code: that no function
-- takes org_id from a request body, that no query uses an oversized .limit().
-- That catches the specific bypass returning, but it is not proof that tenant
-- isolation actually holds. This file is that proof: it creates two
-- organisations with real rows, impersonates a member of each, and asserts that
-- neither can see the other's data through the policies as written.
--
-- Run against a database that has had every migration applied. In CI this runs
-- in the `migrations` job, immediately after the replay, so a policy change
-- that opens a cross-tenant read fails the build.
--
-- Requires auth.uid() to be impersonatable. The CI stub reads
-- request.jwt.claim.sub; on Supabase, auth.uid() reads the real JWT and this
-- file should not be run.

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ──────────────────────────────────────────────────────────────
-- Two organisations, one member each, one client row each.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@org-a.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@org-b.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, legal_name, country_code) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Org A', 'Org A d.o.o.', 'MK'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'Org B d.o.o.', 'MK')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (organization_id, user_id, is_default) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', true),
  ('b0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', true)
ON CONFLICT DO NOTHING;

-- Both are staff: the clients policy is `is_staff() AND organization_id =
-- current_org_id()`, so org membership alone grants nothing. That is the right
-- shape -- it means this test exercises the real access path, not a weaker one.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'operations'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'operations')
ON CONFLICT DO NOTHING;

INSERT INTO public.clients (id, company_name, organization_id) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'Client of A', 'a0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-0000000000b1', 'Client of B', 'b0000000-0000-0000-0000-00000000000b')
ON CONFLICT (id) DO NOTHING;

-- ── Helper ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, what text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN
    RAISE NOTICE '  ok   %', what;
  ELSE
    RAISE EXCEPTION 'RLS ASSERTION FAILED: %', what;
  END IF;
END $$;

-- ── 1. current_org_id() resolves per user, not globally ───────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  public.current_org_id() = 'a0000000-0000-0000-0000-00000000000a',
  'current_org_id() returns Org A for Alice');

SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.assert(
  public.current_org_id() = 'b0000000-0000-0000-0000-00000000000b',
  'current_org_id() returns Org B for Bob');

-- ── 2. is_org_member() does not answer yes for a foreign org ──────────────
SELECT pg_temp.assert(
  public.is_org_member('b0000000-0000-0000-0000-00000000000b'),
  'Bob is a member of Org B');
SELECT pg_temp.assert(
  NOT public.is_org_member('a0000000-0000-0000-0000-00000000000a'),
  'Bob is NOT a member of Org A');

-- ── 3. The actual cross-tenant read. This is the one that matters. ────────
-- Alice must see her own client row and not Bob's.
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.clients WHERE id = 'c0000000-0000-0000-0000-0000000000a1'),
  'Alice can read her own org''s client');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.clients WHERE id = 'c0000000-0000-0000-0000-0000000000b1'),
  'Alice CANNOT read Org B''s client');

SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.clients WHERE id = 'c0000000-0000-0000-0000-0000000000a1'),
  'Bob CANNOT read Org A''s client');

-- ── 4. Nor write into another tenant ──────────────────────────────────────
DO $$
BEGIN
  INSERT INTO public.clients (id, company_name, organization_id)
  VALUES ('c0000000-0000-0000-0000-0000000000b9', 'Smuggled',
          'a0000000-0000-0000-0000-00000000000a');
  RAISE EXCEPTION
    'RLS ASSERTION FAILED: Bob inserted a row into Org A';
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE '  ok   Bob CANNOT insert into Org A';
END $$;

-- ── 5. An anonymous caller sees nothing ───────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.clients),
  'anon reads no client rows at all');

RESET ROLE;

-- ── 6. Every table carrying organization_id enforces RLS ──────────────────
-- A table that gains organization_id but never gets `ENABLE ROW LEVEL
-- SECURITY` is invisible in review and wide open in production.
DO $$
DECLARE
  leaky text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO leaky
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN information_schema.columns col
    ON col.table_schema = 'public'
   AND col.table_name = c.relname
   AND col.column_name = 'organization_id'
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF leaky IS NOT NULL THEN
    RAISE EXCEPTION 'RLS ASSERTION FAILED: tables with organization_id but no RLS: %', leaky;
  END IF;
  RAISE NOTICE '  ok   every organization_id table has RLS enabled';
END $$;

-- ── 7. RLS-enabled tables must actually have a policy ─────────────────────
-- RLS with zero policies denies everything, which is safe but usually a
-- mistake. Only the service-role-only tables below are expected to be bare.
DO $$
DECLARE
  bare text[];
  expected text[] := ARRAY['lead_submission_throttle'];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO bare
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    AND NOT (c.relname = ANY (expected));

  IF bare IS NOT NULL THEN
    RAISE EXCEPTION 'RLS ASSERTION FAILED: RLS enabled but no policy on: %', bare;
  END IF;
  RAISE NOTICE '  ok   every RLS table has a policy (or is a known service-role table)';
END $$;

ROLLBACK;
