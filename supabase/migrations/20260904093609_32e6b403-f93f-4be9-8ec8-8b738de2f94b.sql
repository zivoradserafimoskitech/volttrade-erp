CREATE OR REPLACE FUNCTION public.market_zone_for_source(p_source text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_source IS NULL THEN 'MK'
    WHEN p_source = 'entsoe' THEN 'HU'
    WHEN p_source ILIKE '%-hu' THEN 'HU'
    WHEN p_source ILIKE '%-rs' THEN 'RS'
    WHEN p_source ILIKE '%-si' THEN 'SI'
    WHEN p_source ILIKE '%-gr' THEN 'GR'
    WHEN p_source ILIKE '%-bg' THEN 'BG'
    ELSE 'MK'
  END
$$;

CREATE OR REPLACE FUNCTION public.mirror_market_price_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.market_price_history
    (organization_id, "timestamp", zone, product, price_eur_mwh, source, available_at)
  VALUES
    (v_org, NEW.delivery_at,
     public.market_zone_for_source(NEW.source),
     'DA_HOURLY', NEW.price_eur_mwh,
     coalesce(NEW.source, 'market_prices'), coalesce(NEW.created_at, now()))
  ON CONFLICT (organization_id, "timestamp", zone, product)
  DO UPDATE SET price_eur_mwh = EXCLUDED.price_eur_mwh,
                source        = EXCLUDED.source,
                available_at  = EXCLUDED.available_at;

  RETURN NEW;
END $$;

UPDATE public.market_price_history h
   SET zone = public.market_zone_for_source(h.source)
 WHERE h.zone IS DISTINCT FROM public.market_zone_for_source(h.source);

INSERT INTO public.market_price_history
  (organization_id, "timestamp", zone, product, price_eur_mwh, source, available_at)
SELECT DISTINCT ON (o.id, p.delivery_at, public.market_zone_for_source(p.source))
       o.id, p.delivery_at,
       public.market_zone_for_source(p.source),
       'DA_HOURLY', p.price_eur_mwh, p.source, coalesce(p.created_at, now())
  FROM public.market_prices p
 CROSS JOIN LATERAL (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1) o
 ORDER BY o.id, p.delivery_at, public.market_zone_for_source(p.source), p.created_at DESC
ON CONFLICT (organization_id, "timestamp", zone, product)
DO UPDATE SET price_eur_mwh = EXCLUDED.price_eur_mwh,
              source        = EXCLUDED.source;