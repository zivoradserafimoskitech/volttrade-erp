
-- SITES
CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  country TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  metering_point_id UUID REFERENCES public.metering_points(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own sites" ON public.sites FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ASSETS (BESS / PV / hybrid inverter)
CREATE TYPE public.asset_type AS ENUM ('bess','pv','hybrid');

CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  asset_code TEXT NOT NULL,
  asset_type public.asset_type NOT NULL,
  vendor TEXT,
  model TEXT,
  nameplate_power_kw NUMERIC,         -- AC power rating
  nameplate_energy_kwh NUMERIC,       -- BESS usable energy (null for PV)
  pv_dc_kwp NUMERIC,                  -- PV DC peak (null for BESS)
  external_ref TEXT,                  -- maps to InfluxDB tag asset_code / device id
  install_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own assets" ON public.assets FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_assets_updated BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- TELEMETRY (historical)
CREATE TABLE public.asset_telemetry (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  power_kw NUMERIC,                    -- + discharge / generation, - charge / consumption
  soc_pct NUMERIC,                     -- BESS state of charge
  energy_kwh NUMERIC,                  -- accumulated energy in the interval
  pv_generation_kwh NUMERIC,
  pv_irradiance_w_m2 NUMERIC,
  grid_kw NUMERIC,
  load_kw NUMERIC,
  status TEXT,
  alarm_code TEXT,
  source TEXT DEFAULT 'influxdb',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, ts)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_telemetry TO authenticated;
GRANT ALL ON public.asset_telemetry TO service_role;
ALTER TABLE public.asset_telemetry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own telemetry" ON public.asset_telemetry FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_asset_telemetry_asset_ts ON public.asset_telemetry (asset_id, ts DESC);

-- LATEST SNAPSHOT (live dashboard cache)
CREATE TABLE public.asset_telemetry_latest (
  asset_id UUID PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  power_kw NUMERIC,
  soc_pct NUMERIC,
  pv_generation_kwh NUMERIC,
  grid_kw NUMERIC,
  load_kw NUMERIC,
  status TEXT,
  alarm_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_telemetry_latest TO authenticated;
GRANT ALL ON public.asset_telemetry_latest TO service_role;
ALTER TABLE public.asset_telemetry_latest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own latest" ON public.asset_telemetry_latest FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Enable realtime for the live dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_telemetry_latest;

-- DISPATCH SCHEDULES (planned setpoints / charge-discharge plan)
CREATE TABLE public.asset_dispatch_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES public.schedules(id) ON DELETE SET NULL,
  ts_from TIMESTAMPTZ NOT NULL,
  ts_to TIMESTAMPTZ NOT NULL,
  setpoint_kw NUMERIC NOT NULL,        -- + discharge to grid, - charge from grid
  mode TEXT NOT NULL DEFAULT 'auto',   -- auto / peak_shave / arbitrage / manual
  status TEXT NOT NULL DEFAULT 'planned', -- planned / sent / acknowledged / failed
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_dispatch_schedules TO authenticated;
GRANT ALL ON public.asset_dispatch_schedules TO service_role;
ALTER TABLE public.asset_dispatch_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own dispatch" ON public.asset_dispatch_schedules FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_dispatch_asset_ts ON public.asset_dispatch_schedules (asset_id, ts_from);
CREATE TRIGGER trg_dispatch_updated BEFORE UPDATE ON public.asset_dispatch_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
