-- ═══════════════════════════════════════════════════════════════════
-- ESS (ENTSO-E Scheduling System) support — TPS/PPS generation.
-- Extends the EXISTING trades table (Trade Blotter) rather than creating
-- a parallel trade store. Each schedulable trade becomes one
-- ScheduleTimeSeries in the TPS; the consumption leg comes from
-- balance_schedules (Scheduling & Nomination), and PPS production comes
-- from metering_points + pv_forecasts.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.trades
  -- Schedule inclusion + ESS classification
  ADD COLUMN IF NOT EXISTS schedulable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ess_series_id text,           -- SendersTimeSeriesIdentification (e.g. AXPO_BUY_YEAR_GR)
  ADD COLUMN IF NOT EXISTS ess_business_type text,       -- A01 production | A02 internal trade | A03 external trade | A04 consumption
  ADD COLUMN IF NOT EXISTS in_area_eic text,             -- InArea  (e.g. 10YMK-MEPSO----8)
  ADD COLUMN IF NOT EXISTS out_area_eic text,            -- OutArea (e.g. 10YGR-HTSO-----Y for a Greek border trade)
  ADD COLUMN IF NOT EXISTS capacity_agreement_id text,   -- CapacityAgreementIdentification (cross-border only)
  ADD COLUMN IF NOT EXISTS mtu_shape jsonb;              -- optional 96 values in MW; NULL = flat block from volume_mwh

COMMENT ON COLUMN public.trades.mtu_shape IS
  'Optional array of 96 quarter-hour MW values. NULL means a flat block: MW = volume_mwh / hours(delivery window).';

-- Reference list of ENTSO-E area EIC codes used in SEE scheduling.
CREATE TABLE IF NOT EXISTS public.eic_areas (
  eic text PRIMARY KEY,
  name text NOT NULL,
  country_code text,
  is_default boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.eic_areas TO authenticated;
GRANT ALL ON public.eic_areas TO service_role;
ALTER TABLE public.eic_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read eic_areas" ON public.eic_areas FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "admin write eic_areas" ON public.eic_areas FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]));

INSERT INTO public.eic_areas (eic, name, country_code, is_default) VALUES
  ('10YMK-MEPSO----8', 'MEPSO (MK)', 'MK', true),
  ('10YCS-SERBIATSOV', 'EMS (RS)',   'RS', false),
  ('10YCA-BULGARIA-R', 'ESO (BG)',   'BG', false),
  ('10YGR-HTSO-----Y', 'IPTO (GR)',  'GR', false),
  ('10YCS-CG-TSO---S', 'CGES (ME)',  'ME', false),
  ('10YAL-KESH-----5', 'OST (AL)',   'AL', false),
  ('10YCS-KOSTT-----', 'KOSTT (XK)', 'XK', false),
  ('10YHU-MAVIR----U', 'MAVIR (HU)', 'HU', false)
ON CONFLICT (eic) DO NOTHING;

-- Our own party identity + TSO receiver, used in every ESS header.
CREATE TABLE IF NOT EXISTS public.ess_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  sender_eic text NOT NULL,                                     -- our BRP EIC (33X…)
  sender_role text NOT NULL DEFAULT 'A01',
  receiver_eic text NOT NULL DEFAULT '10XMK-MEPSO----M',         -- MEPSO
  receiver_role text NOT NULL DEFAULT 'A04',
  default_area_eic text NOT NULL DEFAULT '10YMK-MEPSO----8',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ess_settings TO authenticated;
GRANT ALL ON public.ess_settings TO service_role;
ALTER TABLE public.ess_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ess_settings" ON public.ess_settings FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "admin write ess_settings" ON public.ess_settings FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]));

INSERT INTO public.ess_settings (id, sender_eic) VALUES (true, 'CHANGE_ME_SENDER_EIC')
ON CONFLICT (id) DO NOTHING;
