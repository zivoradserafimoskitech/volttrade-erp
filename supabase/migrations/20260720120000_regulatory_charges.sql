-- Regulatory charges for MK supplier invoicing (RKE decisions).
-- Billing reads the row applicable to the invoice period; update by
-- inserting a new row with valid_from when RKE changes a value.
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
CREATE POLICY "auth read regulatory_charges" ON public.regulatory_charges FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write regulatory_charges" ON public.regulatory_charges FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Current values (RKE decision 05.12.2025, effective 01.01.2026; NBRM peg rate)
INSERT INTO public.regulatory_charges (code, label, value, unit, valid_from) VALUES
  ('PPEE_PERCENT', 'Обновлива Енергија (ППЕЕ) — удел во испораката', 12.96, 'percent', '2026-01-01'),
  ('PPEE_PRICE',   'ППЕЕ регулирана набавна цена',                   5.5993826, 'MKD/kWh', '2026-01-01'),
  ('MEMO_FEE',     'Надомест за користење на пазар на електрична енергија', 14.1, 'MKD/MWh', '2026-01-01'),
  ('EUR_MKD',      'Курс EUR/MKD',                                    61.695, 'rate', '2026-01-01')
ON CONFLICT DO NOTHING;
