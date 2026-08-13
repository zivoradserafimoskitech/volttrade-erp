-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1 HARDENING — audit items P1-11, P0-1 (partial), P0-3 (partial)
--
-- Four independent fixes, ordered least→most invasive. Each is idempotent and
-- safe to re-run. None of them require downtime.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. P1-11 — SECURITY DEFINER functions missing SET search_path
--
-- A SECURITY DEFINER function without a pinned search_path executes with the
-- definer's privileges but the CALLER's schema resolution order. A user who
-- can create objects in a schema that resolves earlier can shadow a referenced
-- table or operator and have their code run as the definer.
--
-- Every other SECURITY DEFINER function in this database pins search_path
-- correctly; these four (from 20260811133115_email_infra.sql) were missed.
-- ALTER FUNCTION ... SET is the minimal fix — it does not touch the body.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('enqueue_email', 'read_email_batch', 'delete_email', 'move_to_dlq')
      AND p.prosecdef                                        -- SECURITY DEFINER
      AND NOT EXISTS (                                       -- and not already pinned
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn.sig);
    RAISE NOTICE 'pinned search_path on %', fn.sig;
  END LOOP;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. P0-3 — remove the catastrophic cascade on financial records
--
-- `invoices.user_id` and `clients.user_id` were declared
--     REFERENCES auth.users(id) ON DELETE CASCADE
-- so deleting a staff account DELETES EVERY INVOICE THEY CREATED. That is an
-- unrecoverable loss of tax records, triggerable by accident from the Supabase
-- dashboard.
--
-- Interim fix (full tenancy rework lands in Phase 4): make the column nullable
-- and switch to ON DELETE SET NULL. The column keeps its meaning as "who
-- created this" until Phase 4 renames it to created_by and introduces
-- organization_id.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  con text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'clients', 'metering_points'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'user_id'
    ) THEN
      CONTINUE;
    END IF;

    -- Drop whatever FK currently constrains user_id -> auth.users
    FOR con IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'public' AND rel.relname = t AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) ILIKE '%auth.users%'
        AND pg_get_constraintdef(c.oid) ILIKE '%user_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, con);
    END LOOP;

    -- A financial record must survive the deletion of the account that made it.
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id DROP NOT NULL', t);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) '
      'REFERENCES auth.users(id) ON DELETE SET NULL',
      t, t || '_user_id_fkey'
    );
    RAISE NOTICE 'user_id on public.% is now nullable, ON DELETE SET NULL', t;
  END LOOP;
END $$;

COMMENT ON COLUMN public.invoices.user_id IS
  'Creator of the record. Nullable: set to NULL when the account is deleted so '
  'the invoice survives. Scheduled/automated runs write NULL. Superseded by '
  'created_by + organization_id in Phase 4.';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. P0-1 — invoice idempotency
--
-- `invoices` had UNIQUE only on invoice_number. Nothing prevented running the
-- same billing period twice and issuing a complete duplicate set to every
-- customer — while burning a block of sequence numbers.
--
-- Partial index so that voided/cancelled invoices do not block a legitimate
-- re-issue of the same period (the normal correction workflow).
-- ───────────────────────────────────────────────────────────────────────────

-- Widen the status check first: 'void' is required by the re-issue workflow
-- and by Phase 2's rule that issued invoices are never deleted, only voided.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'paid', 'void', 'cancelled'));

-- Surface any pre-existing duplicates loudly rather than failing on the index
-- with an opaque error.
DO $$
DECLARE
  dupes int;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT client_id, period_start, period_end
    FROM public.invoices
    WHERE status NOT IN ('void', 'cancelled')
    GROUP BY client_id, period_start, period_end
    HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot add the invoice idempotency constraint: % client/period combination(s) '
      'already have duplicate live invoices. Void the surplus invoices first '
      '(UPDATE public.invoices SET status = ''void'' WHERE id = ...), then re-run '
      'this migration.', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_period_unique
  ON public.invoices (client_id, period_start, period_end)
  WHERE status NOT IN ('void', 'cancelled');

COMMENT ON INDEX public.invoices_client_period_unique IS
  'P0-1: one live invoice per client per period. Re-running a billing run is '
  'now a no-op instead of a duplicate issuance. Void an invoice to re-issue.';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Sync observability — structured detail on the API log
--
-- external_api_log.status is an int and there was nowhere to record WHY a sync
-- partially failed, which is what /admin/sync-health needs to be useful.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.external_api_log
  ADD COLUMN IF NOT EXISTS detail jsonb;

COMMENT ON COLUMN public.external_api_log.detail IS
  'Structured result payload (counts, per-device failures). Read by /admin/sync-health.';

CREATE INDEX IF NOT EXISTS idx_external_api_log_provider_recent
  ON public.external_api_log (provider, called_at DESC);