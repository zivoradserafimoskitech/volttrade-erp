REVOKE EXECUTE ON FUNCTION public.guard_issued_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_issued_billing_run() FROM PUBLIC, anon, authenticated;

CREATE POLICY "Users can submit own applications"
ON public.consumer_applications FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role,'supply_manager'::app_role]));

DROP POLICY IF EXISTS "portal owns ev vehicles" ON public.ev_vehicles;
CREATE POLICY "portal owns ev vehicles"
ON public.ev_vehicles FOR ALL TO authenticated
USING (client_id = current_portal_client_id() OR has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role]))
WITH CHECK (client_id = current_portal_client_id() OR has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role]));