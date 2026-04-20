
-- Clients
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  tax_id TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contract_type TEXT NOT NULL DEFAULT 'fixed' CHECK (contract_type IN ('fixed','market')),
  fixed_price_eur_mwh NUMERIC(10,2),
  margin_eur_mwh NUMERIC(10,2) NOT NULL DEFAULT 3.50,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Metering points (EDUs / POD)
CREATE TABLE public.metering_points (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  edu_code TEXT NOT NULL,
  address TEXT,
  voltage_level TEXT,
  annual_consumption_mwh NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HUPX-like hourly market prices
CREATE TABLE public.market_prices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_at TIMESTAMPTZ NOT NULL UNIQUE,
  price_eur_mwh NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hourly consumption: forecast + actual
CREATE TABLE public.consumption_readings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  metering_point_id UUID NOT NULL REFERENCES public.metering_points(id) ON DELETE CASCADE,
  reading_at TIMESTAMPTZ NOT NULL,
  forecast_mwh NUMERIC(12,4),
  actual_mwh NUMERIC(12,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metering_point_id, reading_at)
);

-- Daily trading nominations
CREATE TABLE public.nominations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_date DATE NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  counterparty TEXT,
  volume_mwh NUMERIC(12,2) NOT NULL,
  price_eur_mwh NUMERIC(10,2) NOT NULL,
  balancing_cost_eur NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invoices
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_mwh NUMERIC(12,4) NOT NULL DEFAULT 0,
  energy_amount_eur NUMERIC(12,2) NOT NULL DEFAULT 0,
  margin_amount_eur NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_eur NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metering_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Policies: each authenticated user manages their own clients & invoices & nominations
CREATE POLICY "own clients select" ON public.clients FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own clients insert" ON public.clients FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own clients update" ON public.clients FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own clients delete" ON public.clients FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "own meters select" ON public.metering_points FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));
CREATE POLICY "own meters insert" ON public.metering_points FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));
CREATE POLICY "own meters update" ON public.metering_points FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));
CREATE POLICY "own meters delete" ON public.metering_points FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));

CREATE POLICY "own readings select" ON public.consumption_readings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.metering_points m JOIN public.clients c ON c.id = m.client_id WHERE m.id = metering_point_id AND c.user_id = auth.uid()));
CREATE POLICY "own readings insert" ON public.consumption_readings FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.metering_points m JOIN public.clients c ON c.id = m.client_id WHERE m.id = metering_point_id AND c.user_id = auth.uid()));

-- Market prices: readable by all authenticated users (shared market data), insert by authenticated
CREATE POLICY "prices read" ON public.market_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "prices insert" ON public.market_prices FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "own noms all" ON public.nominations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own invoices all" ON public.invoices FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_meter_client ON public.metering_points(client_id);
CREATE INDEX idx_readings_meter_time ON public.consumption_readings(metering_point_id, reading_at);
CREATE INDEX idx_prices_time ON public.market_prices(delivery_at);
CREATE INDEX idx_invoices_client ON public.invoices(client_id);
