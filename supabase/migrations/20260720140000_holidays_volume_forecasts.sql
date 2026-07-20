-- (a) MK public holidays — profiled consumers behave like Sunday on these days.
CREATE TABLE IF NOT EXISTS public.public_holidays (
  holiday_date date PRIMARY KEY,
  name text NOT NULL
);
GRANT SELECT ON public.public_holidays TO authenticated;
GRANT ALL ON public.public_holidays TO service_role;
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read public_holidays" ON public.public_holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write public_holidays" ON public.public_holidays FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- National non-working days (fixed + movable for 2026; movable dates for
-- future years must be added when confirmed: Orthodox Easter Monday, Ramazan Bajram)
INSERT INTO public.public_holidays (holiday_date, name) VALUES
  ('2026-01-01','Нова Година'),
  ('2026-01-07','Божик (православен)'),
  ('2026-03-20','Рамазан Бајрам (прв ден)'),
  ('2026-04-13','Втор ден Велигден (православен)'),
  ('2026-05-01','Ден на трудот'),
  ('2026-05-24','Св. Кирил и Методиј'),
  ('2026-08-02','Илинден'),
  ('2026-09-08','Ден на независноста'),
  ('2026-10-11','Ден на народното востание'),
  ('2026-10-23','Ден на македонската револуционерна борба'),
  ('2026-12-08','Св. Климент Охридски'),
  ('2027-01-01','Нова Година'),
  ('2027-01-07','Божик (православен)'),
  ('2027-05-01','Ден на трудот'),
  ('2027-05-24','Св. Кирил и Методиј'),
  ('2027-08-02','Илинден'),
  ('2027-09-08','Ден на независноста'),
  ('2027-10-11','Ден на народното востание'),
  ('2027-10-23','Ден на македонската револуционерна борба'),
  ('2027-12-08','Св. Климент Охридски')
ON CONFLICT (holiday_date) DO NOTHING;

-- (b) Volume forecast snapshots — append-only audit trail of what we knew
-- and forecast at each point in time (MAPE and imbalance post-mortems).
CREATE TABLE IF NOT EXISTS public.volume_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('client','slp_category','segment')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  slp_category public.slp_category,
  segment public.schedule_leg,
  month date NOT NULL,                       -- first day of forecast month
  consumed_to_date_mwh numeric NOT NULL DEFAULT 0,
  forecast_mwh numeric NOT NULL,             -- projected full-month total
  method text NOT NULL DEFAULT 'daytype_projection',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.volume_forecasts TO authenticated;
GRANT ALL ON public.volume_forecasts TO service_role;
ALTER TABLE public.volume_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read volume_forecasts" ON public.volume_forecasts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert volume_forecasts" ON public.volume_forecasts FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_volume_forecasts_month ON public.volume_forecasts(month, scope, created_at DESC);
