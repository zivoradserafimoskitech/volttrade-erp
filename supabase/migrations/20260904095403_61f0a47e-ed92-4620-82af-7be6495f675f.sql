CREATE OR REPLACE FUNCTION public.market_zone_for_source(p_source text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_source IS NULL THEN 'MK'
    WHEN p_source = 'entsoe' THEN 'HU'
    WHEN p_source ~ '-[a-z]{2}$' THEN upper(right(p_source, 2))
    ELSE 'MK'
  END
$function$;

-- Re-label existing history from the raw feed. Rows whose zone was wrong
-- (HR filed as MK) are rebuilt; the unique key keeps one row per zone/hour.
DELETE FROM public.market_price_history
WHERE source IS NOT NULL AND source <> 'market_prices';

INSERT INTO public.market_price_history
  (organization_id, "timestamp", zone, product, price_eur_mwh, source, available_at)
SELECT DISTINCT ON (o.id, mp.delivery_at, public.market_zone_for_source(mp.source))
  o.id, mp.delivery_at,
  public.market_zone_for_source(mp.source),
  'DA_HOURLY', mp.price_eur_mwh,
  coalesce(mp.source, 'market_prices'), coalesce(mp.created_at, now())
FROM public.market_prices mp
CROSS JOIN LATERAL (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1) o
ORDER BY o.id, mp.delivery_at, public.market_zone_for_source(mp.source), mp.created_at DESC
ON CONFLICT (organization_id, "timestamp", zone, product)
DO UPDATE SET price_eur_mwh = EXCLUDED.price_eur_mwh,
              source        = EXCLUDED.source,
              available_at  = EXCLUDED.available_at;