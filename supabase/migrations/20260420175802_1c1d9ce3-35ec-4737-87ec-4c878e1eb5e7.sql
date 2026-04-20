DROP POLICY "prices insert" ON public.market_prices;
CREATE POLICY "prices insert" ON public.market_prices FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);