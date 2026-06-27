
-- 1. Enums
DO $$ BEGIN CREATE TYPE public.reading_source AS ENUM ('DSO_MONTHLY','DSO_INTERVAL','PRIVATE_SMART','SIMULATED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.metering_category AS ENUM ('PROFILED','MEASURED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.slp_category AS ENUM ('Office','Cafe_Restaurant','Market_Shop','Bakery','Street_Lighting','Base_Station','Fuel_Station','Household','Household_Electric_Heating'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.consumer_type AS ENUM ('Residential','SOHO','SME','Industrial','Public'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.prosumer_scheme AS ENUM ('NET_METERING','NET_BILLING'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.season_t AS ENUM ('Spring','Summer','Autumn','Winter'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.day_type_t AS ENUM ('WD','SA','SU'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.schedule_leg AS ENUM ('PROFILED','MEASURED','PV'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.settlement_status AS ENUM ('PROVISIONAL','FINAL'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Extend consumption_readings
ALTER TABLE public.consumption_readings
  ADD COLUMN IF NOT EXISTS source public.reading_source NOT NULL DEFAULT 'SIMULATED',
  ADD COLUMN IF NOT EXISTS settlement_relevant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_estimated boolean NOT NULL DEFAULT false;
UPDATE public.consumption_readings SET source='SIMULATED', settlement_relevant=false WHERE source IS NULL;

-- 3. balance_groups
CREATE TABLE IF NOT EXISTS public.balance_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  brp_party text,
  country text DEFAULT 'HU',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.balance_groups TO authenticated;
GRANT ALL ON public.balance_groups TO service_role;
ALTER TABLE public.balance_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read balance_groups" ON public.balance_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write balance_groups" ON public.balance_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_balance_groups_updated BEFORE UPDATE ON public.balance_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. connection_points
CREATE TABLE IF NOT EXISTS public.connection_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  metering_point_id uuid REFERENCES public.metering_points(id) ON DELETE SET NULL,
  metering_category public.metering_category NOT NULL,
  slp_category public.slp_category,
  consumer_type public.consumer_type NOT NULL DEFAULT 'SOHO',
  is_prosumer boolean NOT NULL DEFAULT false,
  pv_capacity_kwp numeric,
  prosumer_scheme public.prosumer_scheme,
  has_private_meter boolean NOT NULL DEFAULT false,
  voltage_level text,
  connection_power_kw numeric,
  eic_metering_id text,
  dso_meter_id text,
  tariff_type text,
  balance_group_id uuid REFERENCES public.balance_groups(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.connection_points TO authenticated;
GRANT ALL ON public.connection_points TO service_role;
ALTER TABLE public.connection_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read connection_points" ON public.connection_points FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write connection_points" ON public.connection_points FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_connection_points_updated BEFORE UPDATE ON public.connection_points FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. slp_coefficients
CREATE TABLE IF NOT EXISTS public.slp_coefficients (
  id bigserial PRIMARY KEY,
  slp_category public.slp_category NOT NULL,
  season public.season_t NOT NULL,
  day_type public.day_type_t NOT NULL,
  hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  coefficient numeric NOT NULL,
  UNIQUE (slp_category, season, day_type, hour)
);
GRANT SELECT ON public.slp_coefficients TO authenticated;
GRANT ALL ON public.slp_coefficients TO service_role;
ALTER TABLE public.slp_coefficients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read slp_coefficients" ON public.slp_coefficients FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write slp_coefficients" ON public.slp_coefficients FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 6. balance_schedules (per-MTU)
CREATE TABLE IF NOT EXISTS public.balance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_group_id uuid NOT NULL REFERENCES public.balance_groups(id) ON DELETE CASCADE,
  date date NOT NULL,
  mtu smallint NOT NULL CHECK (mtu BETWEEN 0 AND 95),
  scheduled_mwh numeric NOT NULL DEFAULT 0,
  leg public.schedule_leg NOT NULL,
  version int NOT NULL DEFAULT 1,
  gate_closure_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (balance_group_id, date, mtu, leg, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.balance_schedules TO authenticated;
GRANT ALL ON public.balance_schedules TO service_role;
ALTER TABLE public.balance_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read balance_schedules" ON public.balance_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write balance_schedules" ON public.balance_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_balance_schedules_updated BEFORE UPDATE ON public.balance_schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_balance_schedules_bg_date ON public.balance_schedules(balance_group_id, date);

-- 7. settlements
CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_group_id uuid REFERENCES public.balance_groups(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  segment public.schedule_leg NOT NULL,
  scheduled_mwh numeric NOT NULL DEFAULT 0,
  actual_mwh numeric NOT NULL DEFAULT 0,
  imbalance_mwh numeric NOT NULL DEFAULT 0,
  imbalance_price numeric NOT NULL DEFAULT 0,
  imbalance_price_up numeric,
  imbalance_price_down numeric,
  imbalance_cost numeric NOT NULL DEFAULT 0,
  status public.settlement_status NOT NULL DEFAULT 'PROVISIONAL',
  grid_loss_factor numeric DEFAULT 1.0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlements TO authenticated;
GRANT ALL ON public.settlements TO service_role;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read settlements" ON public.settlements FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write settlements" ON public.settlements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_settlements_updated BEFORE UPDATE ON public.settlements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
