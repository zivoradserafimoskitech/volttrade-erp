-- 1. Smart meter calibration on metering points
alter table public.metering_points
  add column if not exists smart_meter_calibration numeric not null default 1.0,
  add column if not exists calibration_updated_at  timestamptz,
  add column if not exists calibration_months      int not null default 0;

comment on column public.metering_points.smart_meter_calibration is
  'Ratio official_volume / private_smart_volume learned from months where both exist. 1.0 = uncalibrated.';

-- 2. Daily volume forecast per metering point
create table if not exists public.volume_forecast_daily (
  metering_point_id uuid not null references public.metering_points(id) on delete cascade,
  forecast_date date not null,
  forecast_mwh  numeric not null,
  method        text not null,
  day_type      text not null,
  sample_days   int not null default 0,
  calibration   numeric not null default 1.0,
  created_at    timestamptz not null default now(),
  primary key (metering_point_id, forecast_date)
);

grant select on public.volume_forecast_daily to authenticated;
grant all    on public.volume_forecast_daily to service_role;

alter table public.volume_forecast_daily enable row level security;

drop policy if exists "org staff read volume_forecast_daily" on public.volume_forecast_daily;
create policy "org staff read volume_forecast_daily"
  on public.volume_forecast_daily for select to authenticated
  using (public.is_staff() and exists (
    select 1 from public.metering_points mp
    join public.clients c on c.id = mp.client_id
    where mp.id = volume_forecast_daily.metering_point_id
      and c.organization_id = public.current_org_id()));

create index if not exists volume_forecast_daily_date_idx
  on public.volume_forecast_daily (forecast_date);

-- 3. Battery economic parameters
alter table public.assets
  add column if not exists usable_energy_kwh       numeric,
  add column if not exists charge_efficiency       numeric not null default 0.938,
  add column if not exists discharge_efficiency    numeric not null default 0.938,
  add column if not exists soc_min_pct             numeric not null default 10,
  add column if not exists soc_max_pct             numeric not null default 95,
  add column if not exists soc_terminal_pct        numeric not null default 50,
  add column if not exists degradation_eur_per_mwh numeric,
  add column if not exists max_cycles_per_day      numeric not null default 1.5,
  add column if not exists grid_import_limit_kw    numeric,
  add column if not exists grid_export_limit_kw    numeric;

comment on column public.assets.degradation_eur_per_mwh is
  'Wear cost per MWh throughput = capex / (usable_MWh x warranty_cycles x 2). No default on purpose: the optimizer refuses to run without it.';

-- 4. Optimizer run log
create table if not exists public.bess_optimizer_runs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  horizon_start timestamptz not null,
  horizon_end   timestamptz not null,
  periods int not null,
  start_soc_kwh numeric,
  start_soc_at timestamptz,
  expected_revenue_eur numeric,
  degradation_cost_eur numeric,
  net_value_eur numeric,
  cycles_used numeric,
  binding_constraint text,
  mode text not null default 'arbitrage',
  backtest boolean not null default false,
  prices jsonb,
  plan jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

grant select on public.bess_optimizer_runs to authenticated;
grant all    on public.bess_optimizer_runs to service_role;

alter table public.bess_optimizer_runs enable row level security;

drop policy if exists "org staff read bess_optimizer_runs" on public.bess_optimizer_runs;
create policy "org staff read bess_optimizer_runs"
  on public.bess_optimizer_runs for select to authenticated
  using (public.is_staff() and exists (
    select 1 from public.assets a
    where a.id = bess_optimizer_runs.asset_id
      and a.organization_id = public.current_org_id()));

create index if not exists bess_optimizer_runs_asset_idx
  on public.bess_optimizer_runs (asset_id, created_at desc);
