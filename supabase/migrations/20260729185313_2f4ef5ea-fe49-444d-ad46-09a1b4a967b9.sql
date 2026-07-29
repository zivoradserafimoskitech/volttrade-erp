
-- Trades
DROP POLICY IF EXISTS "trades insert" ON public.trades;
CREATE POLICY "trades insert" ON public.trades FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[])
  AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "trades update" ON public.trades;
CREATE POLICY "trades update" ON public.trades FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[])
       AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[])
       AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "tr sel" ON public.trades;
CREATE POLICY "trades select" ON public.trades FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(),
  ARRAY['admin','management','trader','risk_officer','operations','finance','auditor']::app_role[]));

-- Trading contracts
DROP POLICY IF EXISTS "trading_contracts insert" ON public.trading_contracts;
CREATE POLICY "trading_contracts insert" ON public.trading_contracts FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[])
  AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "trading_contracts update" ON public.trading_contracts;
CREATE POLICY "trading_contracts update" ON public.trading_contracts FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[])
       AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[])
       AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "tc sel" ON public.trading_contracts;
CREATE POLICY "trading_contracts select" ON public.trading_contracts FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(),
  ARRAY['admin','management','trader','risk_officer','operations','finance','auditor']::app_role[]));

-- Counterparties
DROP POLICY IF EXISTS "counterparties insert" ON public.counterparties;
CREATE POLICY "counterparties insert" ON public.counterparties FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader','risk_officer']::app_role[])
  AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "counterparties update" ON public.counterparties;
CREATE POLICY "counterparties update" ON public.counterparties FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','trader','risk_officer']::app_role[])
       AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader','risk_officer']::app_role[])
       AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "cp sel" ON public.counterparties;
CREATE POLICY "counterparties select" ON public.counterparties FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(),
  ARRAY['admin','management','trader','risk_officer','operations','finance','auditor']::app_role[]));

-- Supply contracts: same owner-integrity rule
DROP POLICY IF EXISTS "supply_contracts insert" ON public.supply_contracts;
CREATE POLICY "supply_contracts insert" ON public.supply_contracts FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[])
  AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "supply_contracts update" ON public.supply_contracts;
CREATE POLICY "supply_contracts update" ON public.supply_contracts FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[])
       AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[])
       AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "contracts select" ON public.supply_contracts;
CREATE POLICY "supply_contracts select" ON public.supply_contracts FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(),
  ARRAY['admin','management','supply_manager','operations','billing_officer','finance','auditor']::app_role[]));
