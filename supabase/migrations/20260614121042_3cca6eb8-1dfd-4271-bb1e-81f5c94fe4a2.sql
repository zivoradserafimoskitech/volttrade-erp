ALTER TABLE public.forecasts
  ADD COLUMN IF NOT EXISTS forecast_mwh_external numeric,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_forecasts_user_date ON public.forecasts(user_id, forecast_date);