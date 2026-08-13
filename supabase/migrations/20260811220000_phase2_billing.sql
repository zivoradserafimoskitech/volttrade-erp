-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 — DEFENSIBLE BILLING
--
-- Audit items P0-1 (atomicity, idempotency, server authority), P0-2 (money),
-- item 13 (reproducibility), item 15 (invoice numbering).
--
-- The theme: an invoice must be reproducible from stored inputs three years
-- later, and issuing must be atomic. Everything here supports that.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Input snapshots — item 13
--
-- Today you cannot answer "how was this invoice calculated?" because the
-- inputs (which readings, which prices, which FX rate, which PPEE percentage
-- at what moment) are not recorded. Market prices get corrected, readings get
-- re-validated, regulatory_charges gets a new row — and the invoice becomes
-- unreproducible. When a customer disputes a bill in month 14 you have no
-- defensible answer.
--
-- The snapshot is the complete BillingInput handed to the pure engine. Given
-- the snapshot and the engine version, the invoice is byte-reproducible.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.billing_run_inputs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_run_id    uuid NOT NULL REFERENCES public.billing_runs(id) ON DELETE CASCADE,
  engine_version    text NOT NULL,
  -- The exact BillingInput: contracts, tariffs, readings, price map,
  -- regulatory values, VAT rates. Everything the calculation touched.
  input_snapshot    jsonb NOT NULL,
  -- The engine's own output, before persistence. Lets you diff "what we
  -- calculated" against "what we stored" without re-running anything.
  output_snapshot   jsonb NOT NULL,
  -- sha256 of input_snapshot — cheap tamper-evidence and a fast way to tell
  -- whether a re-run would even produce a different answer.
  input_hash        text NOT NULL,
  warnings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_run_inputs_run
  ON public.billing_run_inputs (billing_run_id, created_at DESC);

ALTER TABLE public.billing_run_inputs ENABLE ROW LEVEL SECURITY;

-- Snapshots are evidence. Staff may read; nobody may modify. Writes come from
-- the edge function via service_role, which bypasses RLS.
CREATE POLICY "staff read billing_run_inputs"
  ON public.billing_run_inputs FOR SELECT TO authenticated
  USING (public.is_staff());

COMMENT ON TABLE public.billing_run_inputs IS
  'Immutable evidence: the exact inputs and outputs of each billing run. An '
  'invoice is reproducible by replaying input_snapshot through the engine '
  'version named in engine_version. Never UPDATE or DELETE these rows.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Invoice numbering — item 15
--
-- FINDINGS
--  a) next_invoice_number() was called BEFORE the insert. A failed insert
--     burned the number permanently.
--  b) Numbers were allocated to DRAFT invoices. A draft that is never issued
--     leaves a permanent gap.
--  c) The sequence is global and never resets at the fiscal year boundary,
--     while the number is formatted 'INV-YYYY-nnnnnn'. In 2027 the first
--     invoice would be INV-2027-000123, not INV-2027-000001.
--
-- Most jurisdictions, Macedonia included, require invoice numbering that is
-- sequential and gapless within a fiscal year. Sequences cannot provide that:
-- nextval() is deliberately non-transactional, so any rollback leaves a hole.
--
-- FIX: allocate the number at ISSUE time inside the issuing transaction, from
-- a per-year counter table with a row lock. Drafts carry NO number. Because
-- allocation happens in the same transaction as the status change, a rollback
-- releases the number.
--
-- NOTE: a row lock serialises issuance. That is intentional and correct —
-- gapless numbering is inherently serial. At your volume (hundreds of invoices
-- monthly) the lock is held for microseconds.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_number_counters (
  fiscal_year  int  PRIMARY KEY,
  prefix       text NOT NULL DEFAULT 'INV',
  last_number  int  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read invoice counters"
  ON public.invoice_number_counters FOR SELECT TO authenticated
  USING (public.is_staff());

COMMENT ON TABLE public.invoice_number_counters IS
  'Gapless per-fiscal-year invoice numbering. Allocation happens inside the '
  'issuing transaction (see issue_billing_run) so a rollback releases the '
  'number. Do not allocate numbers to drafts.';

-- Seed the counter from any numbers already issued, so the new scheme
-- continues rather than colliding with history.
INSERT INTO public.invoice_number_counters (fiscal_year, prefix, last_number)
SELECT
  yr,
  'INV',
  max_n
FROM (
  SELECT
    substring(invoice_number from 'INV-(\d{4})-')::int AS yr,
    max(substring(invoice_number from 'INV-\d{4}-(\d+)')::int) AS max_n
  FROM public.invoices
  WHERE invoice_number ~ '^INV-\d{4}-\d+$'
  GROUP BY 1
) seeded
ON CONFLICT (fiscal_year) DO UPDATE
  SET last_number = GREATEST(public.invoice_number_counters.last_number, EXCLUDED.last_number);

-- Allocate the next number for a fiscal year. MUST be called inside a
-- transaction that also performs the status change.
CREATE OR REPLACE FUNCTION public.allocate_invoice_number(p_fiscal_year int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next   int;
  v_prefix text;
BEGIN
  INSERT INTO public.invoice_number_counters (fiscal_year)
  VALUES (p_fiscal_year)
  ON CONFLICT (fiscal_year) DO NOTHING;

  -- FOR UPDATE serialises concurrent issuance — required for gaplessness.
  SELECT last_number + 1, prefix
    INTO v_next, v_prefix
  FROM public.invoice_number_counters
  WHERE fiscal_year = p_fiscal_year
  FOR UPDATE;

  UPDATE public.invoice_number_counters
     SET last_number = v_next, updated_at = now()
   WHERE fiscal_year = p_fiscal_year;

  RETURN v_prefix || '-' || p_fiscal_year || '-' || lpad(v_next::text, 6, '0');
END $$;

REVOKE ALL ON FUNCTION public.allocate_invoice_number(int) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number(int) TO service_role;

-- Drafts must not carry a number; issued invoices must.
ALTER TABLE public.invoices ALTER COLUMN invoice_number DROP NOT NULL;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_number_when_issued;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_number_when_issued
  CHECK (status = 'draft' OR invoice_number IS NOT NULL);

-- The legacy allocator is retained but neutered, so any missed call site fails
-- loudly instead of silently reintroducing gap-prone numbering.
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'next_invoice_number() is retired. Invoice numbers are allocated at ISSUE '
    'time by issue_billing_run() so that numbering is gapless per fiscal year. '
    'Drafts must not carry a number.';
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Atomic issuance — P0-1
--
-- Previously: the browser looped, inserting invoices one at a time with no
-- transaction. A closed tab mid-run left invoices partially issued with
-- numbers already consumed, and there was no resume and no rollback.
--
-- Now: one function, one transaction. Either every invoice in the run gets a
-- number and becomes 'issued', or none does.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.issue_billing_run(p_run_id uuid)
RETURNS TABLE (invoice_id uuid, invoice_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run    record;
  v_year   int;
  v_inv    record;
  v_number text;
BEGIN
  SELECT * INTO v_run FROM public.billing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing run % not found', p_run_id;
  END IF;
  IF v_run.status = 'issued' THEN
    RAISE EXCEPTION 'Billing run % is already issued', p_run_id;
  END IF;
  IF v_run.status <> 'preview' THEN
    RAISE EXCEPTION 'Billing run % must be in preview to issue (is: %)', p_run_id, v_run.status;
  END IF;

  -- Fiscal year is the year the period ENDS in — the supply is complete then,
  -- which is the tax point for a periodic energy supply.
  v_year := extract(year FROM v_run.period_end)::int;

  FOR v_inv IN
    SELECT id FROM public.invoices
    WHERE billing_run_id = p_run_id AND status = 'draft'
    ORDER BY created_at, id            -- deterministic numbering order
  LOOP
    v_number := public.allocate_invoice_number(v_year);
    UPDATE public.invoices
       SET invoice_number = v_number,
           status = 'issued',
           issued_at = now()
     WHERE id = v_inv.id;
    invoice_id := v_inv.id;
    invoice_number := v_number;
    RETURN NEXT;
  END LOOP;

  UPDATE public.billing_runs SET status = 'issued', updated_at = now() WHERE id = p_run_id;
END $$;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issued_at timestamptz;

REVOKE ALL ON FUNCTION public.issue_billing_run(uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_billing_run(uuid) TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Issued invoices and runs become immutable
--
-- P1-14: the UI deleted a billing run behind a plain confirm(), severing the
-- audit chain on issued tax documents. An issued invoice may only be voided —
-- never deleted, never silently re-priced.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_issued_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION
        'Invoice % has status % and cannot be deleted. Void it instead '
        '(UPDATE public.invoices SET status = ''void'').',
        coalesce(OLD.invoice_number, OLD.id::text), OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- Financial fields of an issued invoice are frozen. Operational fields
  -- (payment tracking, dunning, sent_at) stay editable.
  IF OLD.status IN ('issued', 'paid') THEN
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.total_eur      IS DISTINCT FROM OLD.total_eur
       OR NEW.tax_amount_eur IS DISTINCT FROM OLD.tax_amount_eur
       OR NEW.total_mwh      IS DISTINCT FROM OLD.total_mwh
       OR NEW.components     IS DISTINCT FROM OLD.components
       OR NEW.period_start   IS DISTINCT FROM OLD.period_start
       OR NEW.period_end     IS DISTINCT FROM OLD.period_end
       OR NEW.client_id      IS DISTINCT FROM OLD.client_id
    THEN
      RAISE EXCEPTION
        'Invoice % is issued; its financial content is immutable. Void it and '
        'issue a corrected invoice.', OLD.invoice_number;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_issued_invoice ON public.invoices;
CREATE TRIGGER trg_guard_issued_invoice
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_issued_invoice();

CREATE OR REPLACE FUNCTION public.guard_issued_billing_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION
      'Billing run % is issued and cannot be deleted — it is the audit trail '
      'for % invoice(s).', OLD.id, OLD.invoice_count;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_guard_issued_billing_run ON public.billing_runs;
CREATE TRIGGER trg_guard_issued_billing_run
  BEFORE DELETE ON public.billing_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_issued_billing_run();


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Server authority — P0-1
--
-- RLS gated WHO could write an invoice, never WHAT. A billing_officer could
-- post an arbitrary total from devtools because the calculation lived in
-- client code. Invoices are now written exclusively by the billing-run edge
-- function under service_role.
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "own invoices insert" ON public.invoices;
DROP POLICY IF EXISTS "billing write invoices" ON public.invoices;
DROP POLICY IF EXISTS "invoices insert" ON public.invoices;

-- No INSERT policy for `authenticated` = clients cannot create invoices at
-- all. service_role bypasses RLS, so the edge function is unaffected.
COMMENT ON TABLE public.invoices IS
  'Invoices are created ONLY by the billing-run edge function (service_role). '
  'There is deliberately no INSERT policy for authenticated users: the amounts '
  'must come from the server-side engine, not from the browser.';

-- Payment/dunning updates by the finance roles remain permitted; the trigger
-- above prevents them touching financial content.
DROP POLICY IF EXISTS "billing update invoices" ON public.invoices;
CREATE POLICY "billing update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','management','billing_officer','finance']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['admin','management','billing_officer','finance']::public.app_role[]));


-- ───────────────────────────────────────────────────────────────────────────
-- 6. Regulatory inputs must exist for the billed month
--
-- MEMO publishes the PPEE percentage and average prices per supplier PER
-- MONTH (Прилог 1, т.5 — by the 5th working day). The browser handled a
-- missing month with window.confirm(), which cannot work server-side and was
-- dismissible anyway. Recorded here so the engine can refuse instead.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.regulatory_value_for(p_code text, p_period_start date)
RETURNS numeric
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT value FROM public.regulatory_charges
  WHERE code = p_code
    AND valid_from <= p_period_start
    AND (valid_to IS NULL OR valid_to >= p_period_start)
  ORDER BY valid_from DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.regulatory_value_for(text, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.regulatory_value_for(text, date) IS
  'Value effective at the START of the billed period. The previous client-side '
  'lookup sorted by valid_from descending over rows filtered by period_end, so '
  'a rate introduced mid-period could be applied to the whole period.';
