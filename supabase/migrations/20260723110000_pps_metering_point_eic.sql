-- PPS (Production Party Schedule) support.
-- A production schedule is submitted per metering point, so the point needs
-- its own EIC (Z-code, e.g. 33ZPVOSMSOLARG1R) and the producing party's EIC
-- (X-code) that appears as InParty.
ALTER TABLE public.metering_points
  ADD COLUMN IF NOT EXISTS eic_code text,            -- MeteringPointIdentification (33Z…)
  ADD COLUMN IF NOT EXISTS producer_party_eic text;  -- InParty for production series (33X…)

COMMENT ON COLUMN public.metering_points.eic_code IS
  'ENTSO-E metering point EIC (Z-code) used as MeteringPointIdentification in PPS schedules.';

CREATE INDEX IF NOT EXISTS idx_metering_points_eic
  ON public.metering_points (eic_code) WHERE eic_code IS NOT NULL;
