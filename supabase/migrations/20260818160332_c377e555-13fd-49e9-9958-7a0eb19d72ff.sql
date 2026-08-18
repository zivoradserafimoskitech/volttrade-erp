CREATE POLICY "portal clients read saving sessions"
ON public.saving_sessions
FOR SELECT
TO authenticated
USING (public.current_portal_client_id() IS NOT NULL);