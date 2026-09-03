ALTER VIEW public.v_hourly_position SET (security_invoker = on);
ALTER VIEW public.v_hedge_breaches SET (security_invoker = on);

GRANT SELECT ON public.v_hourly_position TO authenticated;
GRANT SELECT ON public.v_hedge_breaches TO authenticated;

CREATE OR REPLACE FUNCTION public.shape_mask(p_key text, p_hours numeric[])
RETURNS numeric[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_key
    WHEN 'baseload'    THEN array_fill(1::numeric, ARRAY[24])
    WHEN 'peak_08_20'  THEN (SELECT array_agg(CASE WHEN h BETWEEN 8 AND 19 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'offpeak'     THEN (SELECT array_agg(CASE WHEN h < 8 OR h >= 20 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'night_00_06' THEN (SELECT array_agg(CASE WHEN h < 6 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'day_09_16'   THEN (SELECT array_agg(CASE WHEN h BETWEEN 9 AND 15 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'solar_shape' THEN (SELECT array_agg(CASE WHEN h BETWEEN 6 AND 18 THEN 1 ELSE 0 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'wind_shape'  THEN (SELECT array_agg(CASE WHEN h BETWEEN 2 AND 6 OR h BETWEEN 18 AND 23 THEN 1 ELSE 0.5 END::numeric ORDER BY h) FROM generate_series(0,23) h)
    WHEN 'custom'      THEN p_hours
  END;
$$;