
CREATE TABLE public.ppa_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  metering_point_id uuid REFERENCES public.metering_points(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  ppa_code text NOT NULL,
  ppa_type text NOT NULL CHECK (ppa_type IN ('virtual_sleeved','pay_as_produced','surplus_buyback')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  contracted_volume_mwh numeric,
  fixed_price_eur_mwh numeric NOT NULL,
  floor_price_eur_mwh numeric,
  ceiling_price_eur_mwh numeric,
  buyback_price_eur_mwh numeric,
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','suspended','terminated','expired')),
  notes text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppa_agreements TO authenticated;
GRANT ALL ON public.ppa_agreements TO service_role;
ALTER TABLE public.ppa_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage PPAs" ON public.ppa_agreements FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','billing_officer','operations']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','billing_officer','operations']::app_role[]));
CREATE POLICY "Portal customer reads own PPAs" ON public.ppa_agreements FOR SELECT TO authenticated
  USING (client_id = public.current_portal_client_id());
CREATE TRIGGER trg_ppa_updated BEFORE UPDATE ON public.ppa_agreements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ppa_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ppa_id uuid NOT NULL REFERENCES public.ppa_agreements(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  produced_mwh numeric NOT NULL DEFAULT 0,
  delivered_mwh numeric NOT NULL DEFAULT 0,
  surplus_export_mwh numeric NOT NULL DEFAULT 0,
  spot_avg_eur_mwh numeric,
  applied_price_eur_mwh numeric NOT NULL,
  energy_cost_eur numeric NOT NULL DEFAULT 0,
  buyback_credit_eur numeric NOT NULL DEFAULT 0,
  net_amount_eur numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final','invoiced')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ppa_id, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppa_settlements TO authenticated;
GRANT ALL ON public.ppa_settlements TO service_role;
ALTER TABLE public.ppa_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage PPA settlements" ON public.ppa_settlements FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','billing_officer','operations']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','billing_officer','operations']::app_role[]));
CREATE POLICY "Portal customer reads own PPA settlements" ON public.ppa_settlements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ppa_agreements p WHERE p.id = ppa_id AND p.client_id = public.current_portal_client_id()));
CREATE TRIGGER trg_ppa_settle_updated BEFORE UPDATE ON public.ppa_settlements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
