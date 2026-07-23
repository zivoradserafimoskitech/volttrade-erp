-- ППЕЕ (renewable obligation) purchase nomination.
-- Правила за пазар на електрична енергија, Прилог 1, точка 4:
--   TPS_ППЕЕПТ = p[%] × TPS_снабдувач/трговец/ПЕЕ
-- where p[%] is the hourly coefficient published by ОПЕЕ in the final
-- forecast (opee.mepso.com.mk), one day before delivery. The result is
-- rounded to three decimals.
CREATE TABLE IF NOT EXISTS public.ppee_coefficients (
  delivery_date date NOT NULL,
  hour smallint NOT NULL CHECK (hour BETWEEN 1 AND 24),
  coefficient_pct numeric NOT NULL,
  is_final boolean NOT NULL DEFAULT true,   -- преliminary vs final (обврзувачка) forecast
  source text NOT NULL DEFAULT 'OPEE',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_date, hour)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ppee_coefficients TO authenticated;
GRANT ALL ON public.ppee_coefficients TO service_role;
ALTER TABLE public.ppee_coefficients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ppee_coefficients" ON public.ppee_coefficients
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "bal write ppee_coefficients" ON public.ppee_coefficients
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','trader']::public.app_role[]));

-- ОПЕЕ is the counterparty on the ППЕЕ purchase series (OutParty).
ALTER TABLE public.ess_settings
  ADD COLUMN IF NOT EXISTS opee_eic text,
  ADD COLUMN IF NOT EXISTS ppee_series_id text NOT NULL DEFAULT 'PPEE_BUY';
