ALTER TABLE public.market_prices ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'entsoe';
CREATE UNIQUE INDEX IF NOT EXISTS market_prices_delivery_source_uidx ON public.market_prices (delivery_at, source);

CREATE TABLE IF NOT EXISTS public.external_api_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  endpoint text,
  status integer,
  called_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.external_api_log TO authenticated;
GRANT ALL ON public.external_api_log TO service_role;
ALTER TABLE public.external_api_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff can read external api log" ON public.external_api_log;
CREATE POLICY "staff can read external api log" ON public.external_api_log
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','trader','management']::app_role[]));
CREATE INDEX IF NOT EXISTS external_api_log_provider_called_idx ON public.external_api_log (provider, called_at DESC);