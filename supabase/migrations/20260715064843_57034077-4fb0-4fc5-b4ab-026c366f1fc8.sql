DROP POLICY IF EXISTS "prices insert" ON public.market_prices;
CREATE POLICY "prices insert staff only" ON public.market_prices
FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','operations','trader']::app_role[]));

CREATE POLICY "prices update staff only" ON public.market_prices
FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','trader']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','operations','trader']::app_role[]));

CREATE POLICY "prices delete staff only" ON public.market_prices
FOR DELETE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','trader']::app_role[]));