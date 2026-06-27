
-- Add customer role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'customer';

-- Link clients to a portal user
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS portal_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_clients_portal_user ON public.clients(portal_user_id);

-- =================== LEADS ===================
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  country text,
  stage text NOT NULL DEFAULT 'lead', -- lead|qualified|quote|contract_sent|kyc|activated|lost
  source text,                         -- web|referral|cold|switch_in
  owner text,
  est_annual_mwh numeric DEFAULT 0,
  est_value_eur numeric DEFAULT 0,
  lost_reason text,
  notes text,
  converted_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Supply staff manage leads" ON public.leads FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]));
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =================== LEAD QUOTES ===================
CREATE TABLE IF NOT EXISTS public.lead_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tariff_id uuid REFERENCES public.tariffs(id) ON DELETE SET NULL,
  term_months int DEFAULT 12,
  base_price_eur_mwh numeric DEFAULT 0,
  margin_eur_mwh numeric DEFAULT 0,
  annual_volume_mwh numeric DEFAULT 0,
  annual_cost_eur numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'draft', -- draft|sent|accepted|rejected
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_quotes TO authenticated;
GRANT ALL ON public.lead_quotes TO service_role;
ALTER TABLE public.lead_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Supply staff manage quotes" ON public.lead_quotes FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]));
CREATE TRIGGER trg_quotes_updated BEFORE UPDATE ON public.lead_quotes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =================== KYC DOCUMENTS ===================
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  doc_type text NOT NULL, -- company_reg|signatory_id|proof_address|previous_invoice|other
  file_path text NOT NULL,
  file_name text,
  status text NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  reviewer_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyc_documents TO authenticated;
GRANT ALL ON public.kyc_documents TO service_role;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Supply staff manage kyc" ON public.kyc_documents FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]));
CREATE TRIGGER trg_kyc_updated BEFORE UPDATE ON public.kyc_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =================== SWITCH REQUESTS ===================
CREATE TABLE IF NOT EXISTS public.switch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  edu_code text NOT NULL,
  direction text NOT NULL, -- in|out
  current_supplier text,
  new_supplier text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  requested_date date,
  confirmed_date date,
  dso_status text NOT NULL DEFAULT 'draft', -- draft|req_sent|ack|confirmed|rejected
  volume_estimate_mwh numeric DEFAULT 0,
  win_back_offered boolean DEFAULT false,
  win_back_discount_eur_mwh numeric,
  lost_reason text,
  message_envelope text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.switch_requests TO authenticated;
GRANT ALL ON public.switch_requests TO service_role;
ALTER TABLE public.switch_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Supply staff manage switches" ON public.switch_requests FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager']::app_role[]));
CREATE TRIGGER trg_switch_updated BEFORE UPDATE ON public.switch_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =================== PORTAL ACCESS POLICIES ===================
-- Allow customers to read their own client record
CREATE POLICY "Portal user views own client" ON public.clients FOR SELECT TO authenticated
  USING (portal_user_id = auth.uid());
CREATE POLICY "Portal user updates own client contact" ON public.clients FOR UPDATE TO authenticated
  USING (portal_user_id = auth.uid())
  WITH CHECK (portal_user_id = auth.uid());

-- Helper: returns the client_id linked to current auth user
CREATE OR REPLACE FUNCTION public.current_portal_client_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.clients WHERE portal_user_id = auth.uid() LIMIT 1
$$;

CREATE POLICY "Portal views own EDUs" ON public.metering_points FOR SELECT TO authenticated
  USING (client_id = public.current_portal_client_id());

CREATE POLICY "Portal views own invoices" ON public.invoices FOR SELECT TO authenticated
  USING (client_id = public.current_portal_client_id());

CREATE POLICY "Portal views own meter readings" ON public.meter_readings FOR SELECT TO authenticated
  USING (metering_point_id IN (SELECT id FROM public.metering_points WHERE client_id = public.current_portal_client_id()));

CREATE POLICY "Portal submits own meter readings" ON public.meter_readings FOR INSERT TO authenticated
  WITH CHECK (metering_point_id IN (SELECT id FROM public.metering_points WHERE client_id = public.current_portal_client_id()));
