
-- 1) Lock down shared write tables
DROP POLICY IF EXISTS "auth write balance_groups" ON public.balance_groups;
CREATE POLICY "staff write balance_groups" ON public.balance_groups FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','operations']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','operations']::app_role[]));

DROP POLICY IF EXISTS "auth write balance_schedules" ON public.balance_schedules;
CREATE POLICY "staff write balance_schedules" ON public.balance_schedules FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','operations']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','operations']::app_role[]));

DROP POLICY IF EXISTS "auth write settlements" ON public.settlements;
CREATE POLICY "staff write settlements" ON public.settlements FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','operations','finance','billing_officer']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','operations','finance','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "auth write connection_points" ON public.connection_points;
CREATE POLICY "staff write connection_points" ON public.connection_points FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','operations','supply_manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management','operations','supply_manager']::app_role[]));

-- 2) Portal users can view their own switch requests
CREATE POLICY "Portal users view own switch_requests" ON public.switch_requests FOR SELECT TO authenticated
  USING (client_id = public.current_portal_client_id());

-- 3) Lead owners can view their own leads
CREATE POLICY "Lead owners view own leads" ON public.leads FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 4) Remove self-bootstrap admin escalation
DROP POLICY IF EXISTS "self bootstrap admin" ON public.user_roles;

-- 5) Restrict SECURITY DEFINER helpers from public/anon
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_portal_client_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_portal_client_id() TO authenticated;
