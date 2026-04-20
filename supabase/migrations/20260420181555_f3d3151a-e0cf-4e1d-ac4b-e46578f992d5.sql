
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP POLICY IF EXISTS "audit insert" ON public.audit_log;
CREATE POLICY "audit insert" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
