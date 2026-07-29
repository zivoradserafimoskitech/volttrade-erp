-- 1. supply_contract_points: mirror ownership check in WITH CHECK
DROP POLICY IF EXISTS "supply_contract_points write" ON public.supply_contract_points;
CREATE POLICY "supply_contract_points write"
ON public.supply_contract_points
FOR ALL
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[])
  AND EXISTS (
    SELECT 1 FROM public.supply_contracts c
    WHERE c.id = supply_contract_points.contract_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['admin','management','supply_manager','operations']::app_role[])
  AND EXISTS (
    SELECT 1 FROM public.supply_contracts c
    WHERE c.id = supply_contract_points.contract_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
);

-- 2. tariff_switch_requests: align WITH CHECK with USING
DROP POLICY IF EXISTS "portal owns switch requests" ON public.tariff_switch_requests;
CREATE POLICY "portal owns switch requests"
ON public.tariff_switch_requests
FOR ALL
TO authenticated
USING (
  client_id = public.current_portal_client_id()
  OR public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[])
)
WITH CHECK (
  client_id = public.current_portal_client_id()
  OR public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[])
);

-- 3. Revoke direct EXECUTE on trigger-only SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.clients_block_portal_sensitive_update() FROM PUBLIC, anon, authenticated;
