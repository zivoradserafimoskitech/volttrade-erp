create table if not exists public.meter_load_profiles (
  metering_point_id uuid not null references public.metering_points(id) on delete cascade,
  season      text not null check (season in ('Spring','Summer','Autumn','Winter')),
  day_type    text not null check (day_type in ('WD','SA','SU')),
  hour        int  not null check (hour between 0 and 23),
  share       numeric not null check (share >= 0),
  sample_days int not null,
  updated_at  timestamptz not null default now(),
  primary key (metering_point_id, season, day_type, hour)
);

create index if not exists idx_mlp_mp on public.meter_load_profiles (metering_point_id);

alter table public.meter_load_profiles enable row level security;
grant select on public.meter_load_profiles to authenticated;
grant all    on public.meter_load_profiles to service_role;

drop policy if exists "org staff read meter_load_profiles" on public.meter_load_profiles;
create policy "org staff read meter_load_profiles"
  on public.meter_load_profiles for select to authenticated
  using (
    public.is_staff() and exists (
      select 1 from public.metering_points mp
      join public.clients c on c.id = mp.client_id
      where mp.id = meter_load_profiles.metering_point_id
        and c.organization_id = public.current_org_id())
  );

comment on table public.meter_load_profiles is
  'Hourly load curve per metering point for MEASURED (>40 kW). Written only by the build-meter-profiles edge function (service_role). Empty until enough measured days exist — expected, not an error.';