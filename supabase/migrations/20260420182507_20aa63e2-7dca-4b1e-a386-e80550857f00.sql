-- Counterparties
CREATE TABLE public.counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  legal_name TEXT NOT NULL,
  short_name TEXT,
  country_code TEXT REFERENCES public.countries(code),
  eic_code TEXT,
  vat_number TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 14,
  credit_limit_eur NUMERIC NOT NULL DEFAULT 0,
  risk_status TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cp sel" ON public.counterparties FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','trader','risk_officer','operations','management','finance']::app_role[]));
CREATE POLICY "cp ins" ON public.counterparties FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cp upd" ON public.counterparties FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "cp del" ON public.counterparties FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER cp_upd BEFORE UPDATE ON public.counterparties FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trading contracts
CREATE TABLE public.trading_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  counterparty_id UUID NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  contract_number TEXT NOT NULL,
  contract_type TEXT NOT NULL DEFAULT 'bilateral',
  start_date DATE NOT NULL,
  end_date DATE,
  signed_date DATE,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trading_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tc sel" ON public.trading_contracts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','trader','risk_officer','operations','management','finance']::app_role[]));
CREATE POLICY "tc ins" ON public.trading_contracts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tc upd" ON public.trading_contracts FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "tc del" ON public.trading_contracts FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER tc_upd BEFORE UPDATE ON public.trading_contracts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trades (blotter)
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trade_number TEXT NOT NULL,
  counterparty_id UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  trading_contract_id UUID REFERENCES public.trading_contracts(id) ON DELETE SET NULL,
  market TEXT NOT NULL DEFAULT 'bilateral',
  side TEXT NOT NULL,
  delivery_start TIMESTAMPTZ NOT NULL,
  delivery_end TIMESTAMPTZ NOT NULL,
  hub TEXT,
  volume_mwh NUMERIC NOT NULL,
  price_eur_mwh NUMERIC NOT NULL,
  total_value_eur NUMERIC GENERATED ALWAYS AS (volume_mwh * price_eur_mwh) STORED,
  trader TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tr sel" ON public.trades FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','trader','risk_officer','operations','management','finance']::app_role[]));
CREATE POLICY "tr ins" ON public.trades FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tr upd" ON public.trades FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "tr del" ON public.trades FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER tr_upd BEFORE UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_trades_delivery ON public.trades(delivery_start);
CREATE INDEX idx_trades_cp ON public.trades(counterparty_id);

-- Schedules
CREATE TABLE public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  schedule_number TEXT NOT NULL,
  tso_area TEXT NOT NULL,
  delivery_date DATE NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planned',
  submitted_at TIMESTAMPTZ,
  response_at TIMESTAMPTZ,
  message_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sch sel" ON public.schedules FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','trader','risk_officer','operations','management']::app_role[]));
CREATE POLICY "sch ins" ON public.schedules FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sch upd" ON public.schedules FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "sch del" ON public.schedules FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER sch_upd BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Schedule lines (hourly)
CREATE TABLE public.schedule_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
  direction TEXT NOT NULL DEFAULT 'in',
  volume_mwh NUMERIC NOT NULL DEFAULT 0,
  trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(schedule_id, hour, direction)
);
ALTER TABLE public.schedule_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sl all" ON public.schedule_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_lines.schedule_id AND (s.user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','trader','operations','management']::app_role[]))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_lines.schedule_id AND s.user_id = auth.uid()));