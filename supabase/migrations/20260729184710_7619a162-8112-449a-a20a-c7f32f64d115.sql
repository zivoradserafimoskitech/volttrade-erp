
-- 1. Remove leftover privileges for signed-out (anon) role; no policy targets anon anyway.
REVOKE ALL ON public.leads, public.lead_quotes, public.kyc_documents,
  public.supply_contracts, public.supply_contract_points,
  public.trading_contracts, public.trades, public.counterparties FROM anon;

-- 2. Trading domain: creation must require a trading role, not just being signed in.
DROP POLICY IF EXISTS "tr ins" ON public.trades;
CREATE POLICY "trades insert" ON public.trades FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_any_role(auth.uid(),
  ARRAY['admin','management','trader']::app_role[]));

DROP POLICY IF EXISTS "tr upd" ON public.trades;
CREATE POLICY "trades update" ON public.trades FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[])
       AND (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin')))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[]));

DROP POLICY IF EXISTS "tr del" ON public.trades;
CREATE POLICY "trades delete" ON public.trades FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin')
       OR (auth.uid() = user_id AND public.has_any_role(auth.uid(), ARRAY['management','trader']::app_role[])));

DROP POLICY IF EXISTS "tc ins" ON public.trading_contracts;
CREATE POLICY "trading_contracts insert" ON public.trading_contracts FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_any_role(auth.uid(),
  ARRAY['admin','management','trader']::app_role[]));

DROP POLICY IF EXISTS "tc upd" ON public.trading_contracts;
CREATE POLICY "trading_contracts update" ON public.trading_contracts FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[])
       AND (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin')))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader']::app_role[]));

DROP POLICY IF EXISTS "tc del" ON public.trading_contracts;
CREATE POLICY "trading_contracts delete" ON public.trading_contracts FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin')
       OR (auth.uid() = user_id AND public.has_any_role(auth.uid(), ARRAY['management','trader']::app_role[])));

DROP POLICY IF EXISTS "cp ins" ON public.counterparties;
CREATE POLICY "counterparties insert" ON public.counterparties FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_any_role(auth.uid(),
  ARRAY['admin','management','trader','risk_officer']::app_role[]));

DROP POLICY IF EXISTS "cp upd" ON public.counterparties;
CREATE POLICY "counterparties update" ON public.counterparties FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','trader','risk_officer']::app_role[])
       AND (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin')))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','trader','risk_officer']::app_role[]));

DROP POLICY IF EXISTS "cp del" ON public.counterparties;
CREATE POLICY "counterparties delete" ON public.counterparties FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin')
       OR (auth.uid() = user_id AND public.has_role(auth.uid(), 'management')));

-- 3. Supply contracts: creation/editing must require a supply role.
DROP POLICY IF EXISTS "contracts ins" ON public.supply_contracts;
CREATE POLICY "supply_contracts insert" ON public.supply_contracts FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_any_role(auth.uid(),
  ARRAY['admin','management','supply_manager','operations']::app_role[]));

DROP POLICY IF EXISTS "contracts upd" ON public.supply_contracts;
CREATE POLICY "supply_contracts update" ON public.supply_contracts FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[])
       AND (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin')))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[]));

DROP POLICY IF EXISTS "contracts del" ON public.supply_contracts;
CREATE POLICY "supply_contracts delete" ON public.supply_contracts FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin')
       OR (auth.uid() = user_id AND public.has_any_role(auth.uid(), ARRAY['management','supply_manager']::app_role[])));

-- 4. Supply contract points inherit the parent contract, but also need a supply role.
DROP POLICY IF EXISTS "scp all" ON public.supply_contract_points;
CREATE POLICY "supply_contract_points read" ON public.supply_contract_points FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.supply_contracts c
  WHERE c.id = contract_id
    AND (c.user_id = auth.uid() OR public.has_any_role(auth.uid(),
      ARRAY['admin','management','supply_manager','operations','billing_officer','finance']::app_role[]))));

CREATE POLICY "supply_contract_points write" ON public.supply_contract_points FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[])
  AND EXISTS (SELECT 1 FROM public.supply_contracts c
    WHERE c.id = contract_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[])
  AND EXISTS (SELECT 1 FROM public.supply_contracts c WHERE c.id = contract_id));
