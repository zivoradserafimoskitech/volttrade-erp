DROP POLICY IF EXISTS "portal clients read saving sessions" ON public.saving_sessions;
CREATE POLICY "portal clients read published saving sessions"
ON public.saving_sessions
FOR SELECT
TO authenticated
USING (
  public.current_portal_client_id() IS NOT NULL
  AND status IN ('published','open','active','running','completed','closed')
);