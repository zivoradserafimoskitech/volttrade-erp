
-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM (
  'admin','management','trader','supply_manager','billing_officer',
  'finance','risk_officer','operations','auditor'
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;

CREATE POLICY "users view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Bootstrap: first authenticated user with no roles becomes admin via insert from app
-- (handled in client; alternatively allow self-insert if no admins exist)
CREATE POLICY "self bootstrap admin" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND role = 'admin'
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role='admin')
  );

-- ============ AUDIT ============
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  user_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit read" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','auditor','management']::public.app_role[]) OR user_id = auth.uid());
CREATE POLICY "audit insert" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- ============ COUNTRIES ============
CREATE TABLE public.countries (
  code text PRIMARY KEY,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  vat_percent numeric NOT NULL DEFAULT 0,
  tso_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "countries read" ON public.countries FOR SELECT TO authenticated USING (true);
CREATE POLICY "countries admin" ON public.countries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.countries(code,name,currency,vat_percent,tso_code) VALUES
('HU','Hungary','EUR',27,'MAVIR'),
('RO','Romania','EUR',19,'TRANSELECTRICA'),
('BG','Bulgaria','EUR',20,'ESO'),
('RS','Serbia','EUR',20,'EMS'),
('AT','Austria','EUR',20,'APG'),
('DE','Germany','EUR',19,'TENNET'),
('SK','Slovakia','EUR',20,'SEPS'),
('HR','Croatia','EUR',25,'HOPS');

-- ============ CLIENTS extension ============
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS customer_category text NOT NULL DEFAULT 'commercial',
  ADD COLUMN IF NOT EXISTS payment_terms_days int NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS credit_limit_eur numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country_code text REFERENCES public.countries(code),
  ADD COLUMN IF NOT EXISTS notes text;

-- ============ METERING POINTS extension ============
ALTER TABLE public.metering_points
  ADD COLUMN IF NOT EXISTS dso_area text,
  ADD COLUMN IF NOT EXISTS capacity_kw numeric,
  ADD COLUMN IF NOT EXISTS connection_type text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS meter_id text,
  ADD COLUMN IF NOT EXISTS notes text;

-- ============ TARIFFS ============
CREATE TABLE public.tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  model text NOT NULL DEFAULT 'fixed', -- fixed/indexed/tou/block/custom
  currency text NOT NULL DEFAULT 'EUR',
  valid_from date NOT NULL,
  valid_to date,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  vat_included boolean NOT NULL DEFAULT false,
  customer_segment text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tariffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tariffs select" ON public.tariffs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','billing_officer','management','finance']::public.app_role[]));
CREATE POLICY "tariffs ins" ON public.tariffs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tariffs upd" ON public.tariffs FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "tariffs del" ON public.tariffs FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- ============ SUPPLY CONTRACTS ============
CREATE TABLE public.supply_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contract_number text NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tariff_id uuid REFERENCES public.tariffs(id),
  start_date date NOT NULL,
  end_date date,
  annual_volume_mwh numeric DEFAULT 0,
  payment_terms_days int NOT NULL DEFAULT 14,
  status text NOT NULL DEFAULT 'draft', -- draft/active/suspended/terminated
  auto_renew boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.supply_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts select" ON public.supply_contracts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','billing_officer','management','finance','supply_manager']::public.app_role[]));
CREATE POLICY "contracts ins" ON public.supply_contracts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contracts upd" ON public.supply_contracts FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "contracts del" ON public.supply_contracts FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.supply_contract_points (
  contract_id uuid NOT NULL REFERENCES public.supply_contracts(id) ON DELETE CASCADE,
  metering_point_id uuid NOT NULL REFERENCES public.metering_points(id) ON DELETE CASCADE,
  PRIMARY KEY (contract_id, metering_point_id)
);
ALTER TABLE public.supply_contract_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scp all" ON public.supply_contract_points FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.supply_contracts c WHERE c.id = contract_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.supply_contracts c WHERE c.id = contract_id AND c.user_id = auth.uid()));

-- ============ METER READINGS (new) ============
CREATE TABLE public.meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metering_point_id uuid NOT NULL REFERENCES public.metering_points(id) ON DELETE CASCADE,
  reading_at timestamptz NOT NULL,
  import_kwh numeric NOT NULL DEFAULT 0,
  export_kwh numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual', -- manual/import/api/estimated
  validation_status text NOT NULL DEFAULT 'pending', -- pending/validated/rejected/corrected
  validated_by uuid,
  validated_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "readings sel" ON public.meter_readings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.metering_points m JOIN public.clients c ON c.id = m.client_id
    WHERE m.id = metering_point_id AND (c.user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','billing_officer','management','operations']::public.app_role[]))
  ));
CREATE POLICY "readings ins" ON public.meter_readings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.metering_points m JOIN public.clients c ON c.id = m.client_id
    WHERE m.id = metering_point_id AND c.user_id = auth.uid()
  ));
CREATE POLICY "readings upd" ON public.meter_readings FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.metering_points m JOIN public.clients c ON c.id = m.client_id
    WHERE m.id = metering_point_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  ));
CREATE POLICY "readings del" ON public.meter_readings FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.metering_points m JOIN public.clients c ON c.id = m.client_id
    WHERE m.id = metering_point_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  ));

-- ============ BILLING RUNS ============
CREATE TABLE public.billing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft/preview/approved/issued
  scope text NOT NULL DEFAULT 'all', -- all/customer/contract
  scope_id uuid,
  total_mwh numeric NOT NULL DEFAULT 0,
  total_eur numeric NOT NULL DEFAULT 0,
  invoice_count int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs sel" ON public.billing_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','billing_officer','management','finance']::public.app_role[]));
CREATE POLICY "runs ins" ON public.billing_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "runs upd" ON public.billing_runs FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "runs del" ON public.billing_runs FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- ============ INVOICES extension ============
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS billing_run_id uuid REFERENCES public.billing_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tax_amount_eur numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS paid_amount_eur numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice'; -- invoice/credit_note/debit_note

-- ============ PAYMENTS ============
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  amount_eur numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  paid_at date NOT NULL DEFAULT CURRENT_DATE,
  method text NOT NULL DEFAULT 'bank_transfer',
  bank_reference text,
  status text NOT NULL DEFAULT 'unallocated', -- unallocated/partial/allocated
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay sel" ON public.payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','finance','billing_officer','management']::public.app_role[]));
CREATE POLICY "pay ins" ON public.payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pay upd" ON public.payments FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "pay del" ON public.payments FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount_eur numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alloc all" ON public.payment_allocations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_id AND (p.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_id AND p.user_id = auth.uid()));

-- ============ updated_at triggers ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_tariffs_upd BEFORE UPDATE ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_contracts_upd BEFORE UPDATE ON public.supply_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_runs_upd BEFORE UPDATE ON public.billing_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ indexes ============
CREATE INDEX idx_readings_mp_time ON public.meter_readings(metering_point_id, reading_at DESC);
CREATE INDEX idx_contracts_client ON public.supply_contracts(client_id);
CREATE INDEX idx_alloc_invoice ON public.payment_allocations(invoice_id);
CREATE INDEX idx_alloc_payment ON public.payment_allocations(payment_id);
