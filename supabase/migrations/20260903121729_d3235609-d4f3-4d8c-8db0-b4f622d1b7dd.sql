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
    (v_org, NEW.delivery_at, 'MK', 'DA_HOURLY', NEW.price_eur_mwh,
     coalesce(NEW.source, 'market_prices'), coalesce(NEW.created_at, now()))
  ON CONFLICT (organization_id, "timestamp", zone, product)
  DO UPDATE SET price_eur_mwh = EXCLUDED.price_eur_mwh,
                source        = EXCLUDED.source,
                available_at  = EXCLUDED.available_at;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_market_price_history ON public.market_prices;
CREATE TRIGGER trg_mirror_market_price_history
AFTER INSERT OR UPDATE ON public.market_prices
FOR EACH ROW EXECUTE FUNCTION public.mirror_market_price_history();