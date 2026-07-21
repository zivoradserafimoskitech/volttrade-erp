-- ELEX integration: price source tagging + external API call log (rate cap)
ALTER TABLE public.market_prices
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'entsoe';
-- Same delivery hour can exist from two sources during the test phase
ALTER TABLE public.market_prices DROP CONSTRAINT IF EXISTS market_prices_delivery_at_key;
CREATE UNIQUE INDEX IF NOT EXISTS market_prices_delivery_source_unique
  ON public.market_prices (delivery_at, source);

CREATE TABLE IF NOT EXISTS public.external_api_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  endpoint text,
  status int,
  called_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.external_api_log TO authenticated;
GRANT ALL ON public.external_api_log TO service_role;
ALTER TABLE public.external_api_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read api log" ON public.external_api_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "service write api log" ON public.external_api_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_external_api_log_day ON public.external_api_log (provider, called_at);
