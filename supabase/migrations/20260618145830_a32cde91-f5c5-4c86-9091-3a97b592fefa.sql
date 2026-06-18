CREATE TABLE IF NOT EXISTS public.slp_profiles (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.slp_profiles TO anon, authenticated;
GRANT ALL ON public.slp_profiles TO service_role;
ALTER TABLE public.slp_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slp_profiles_read_all" ON public.slp_profiles FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.slp_curve_points (
  profile_code text NOT NULL REFERENCES public.slp_profiles(code) ON DELETE CASCADE,
  season text NOT NULL CHECK (season IN ('spring','summer','autumn','winter')),
  day_type text NOT NULL CHECK (day_type IN ('WD','SA','SU')),
  hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  factor numeric NOT NULL,
  PRIMARY KEY (profile_code, season, day_type, hour)
);
GRANT SELECT ON public.slp_curve_points TO anon, authenticated;
GRANT ALL ON public.slp_curve_points TO service_role;
ALTER TABLE public.slp_curve_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slp_curve_points_read_all" ON public.slp_curve_points FOR SELECT USING (true);

ALTER TABLE public.metering_points
  ADD COLUMN IF NOT EXISTS consumer_category text NOT NULL DEFAULT 'smart_hourly'
    CHECK (consumer_category IN ('slp','smart_daily','smart_hourly')),
  ADD COLUMN IF NOT EXISTS connected_power_kw numeric,
  ADD COLUMN IF NOT EXISTS slp_profile_code text REFERENCES public.slp_profiles(code);

INSERT INTO public.slp_profiles (code, name) VALUES
('office','Office'),
('cafe_restaurant','Cafe / Restaurant'),
('market_shop','Market / Shop'),
('bakery','Bakery'),
('street_lighting','Street Lighting'),
('transmitter_basestation','Transmitter / Base station'),
('gas_station','Gas Station'),
('household','Household'),
('household_electric_heating','Household with electric heating')
ON CONFLICT (code) DO NOTHING;