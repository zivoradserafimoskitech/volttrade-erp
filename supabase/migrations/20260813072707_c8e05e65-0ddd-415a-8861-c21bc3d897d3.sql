-- Prerequisite: regulatory charges table referenced by the Phase 2 billing engine.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = auth.uid() AND role <> 'customer'::public.app_role
) $$;
REVOKE ALL ON FUNCTION public.is_staff() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.regulatory_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,               -- PPEE_PERCENT | PPEE_PRICE | MEMO_FEE | EUR_MKD
  label text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,               -- percent | MKD/kWh | MKD/MWh | rate
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.regulatory_charges TO authenticated;
GRANT ALL ON public.regulatory_charges TO service_role;
ALTER TABLE public.regulatory_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read regulatory_charges" ON public.regulatory_charges;
CREATE POLICY "auth read regulatory_charges" ON public.regulatory_charges FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin write regulatory_charges" ON public.regulatory_charges;
CREATE POLICY "admin write regulatory_charges" ON public.regulatory_charges FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.regulatory_charges (code, label, value, unit, valid_from) VALUES
  ('PPEE_PERCENT', 'Обновлива Енергија (ППЕЕ) — удел во испораката', 12.96, 'percent', '2026-01-01'),
  ('PPEE_PRICE',   'ППЕЕ регулирана набавна цена',                   5.5993826, 'MKD/kWh', '2026-01-01'),
  ('MEMO_FEE',     'Надомест за користење на пазар на електрична енергија', 14.1, 'MKD/MWh', '2026-01-01'),
  ('EUR_MKD',      'Курс EUR/MKD',                                    61.695, 'rate', '2026-01-01')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 — DEFENSIBLE BILLING
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.billing_run_inputs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_run_id    uuid NOT NULL REFERENCES public.billing_runs(id) ON DELETE CASCADE,
  engine_version    text NOT NULL,
  input_snapshot    jsonb NOT NULL,
  output_snapshot   jsonb NOT NULL,
  input_hash        text NOT NULL,
  warnings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing_run_inputs TO authenticated;
GRANT ALL ON public.billing_run_inputs TO service_role;

CREATE INDEX IF NOT EXISTS idx_billing_run_inputs_run
  ON public.billing_run_inputs (billing_run_id, created_at DESC);

ALTER TABLE public.billing_run_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read billing_run_inputs" ON public.billing_run_inputs;
CREATE POLICY "staff read billing_run_inputs"
  ON public.billing_run_inputs FOR SELECT TO authenticated
  USING (public.is_staff());

COMMENT ON TABLE public.billing_run_inputs IS
  'Immutable evidence: the exact inputs and outputs of each billing run.';

CREATE TABLE IF NOT EXISTS public.invoice_number_counters (
  fiscal_year  int  PRIMARY KEY,
  prefix       text NOT NULL DEFAULT 'INV',
  last_number  int  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.invoice_number_counters TO authenticated;
GRANT ALL ON public.invoice_number_counters TO service_role;

ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read invoice counters" ON public.invoice_number_counters;
CREATE POLICY "staff read invoice counters"
  ON public.invoice_number_counters FOR SELECT TO authenticated
  USING (public.is_staff());

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

REVOKE ALL ON FUNCTION public.allocate_invoice_number(int) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number(int) TO service_role;

ALTER TABLE public.invoices ALTER COLUMN invoice_number DROP NOT NULL;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_number_when_issued;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_number_when_issued
  CHECK (status = 'draft' OR invoice_number IS NOT NULL);

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

REVOKE ALL ON FUNCTION public.next_invoice_number() FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO service_role;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issued_at timestamptz;

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

  v_year := extract(year FROM v_run.period_end)::int;

  FOR v_inv IN
    SELECT id FROM public.invoices
    WHERE billing_run_id = p_run_id AND status = 'draft'
    ORDER BY created_at, id
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

REVOKE ALL ON FUNCTION public.issue_billing_run(uuid) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.issue_billing_run(uuid) TO service_role;

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

DROP POLICY IF EXISTS "own invoices insert" ON public.invoices;
DROP POLICY IF EXISTS "billing write invoices" ON public.invoices;
DROP POLICY IF EXISTS "invoices insert" ON public.invoices;

COMMENT ON TABLE public.invoices IS
  'Invoices are created ONLY by the billing-run edge function (service_role).';

DROP POLICY IF EXISTS "billing update invoices" ON public.invoices;
CREATE POLICY "billing update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','management','billing_officer','finance']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['admin','management','billing_officer','finance']::public.app_role[]));

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

REVOKE ALL ON FUNCTION public.regulatory_value_for(text, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.regulatory_value_for(text, date) TO authenticated, service_role;