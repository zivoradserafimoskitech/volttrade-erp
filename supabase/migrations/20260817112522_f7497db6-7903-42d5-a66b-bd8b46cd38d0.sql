DROP POLICY IF EXISTS "anyone authenticated reads sessions" ON public.saving_sessions;

CREATE POLICY "org staff read saving_sessions"
ON public.saving_sessions
FOR SELECT
TO authenticated
USING (public.is_staff());