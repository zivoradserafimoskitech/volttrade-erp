
CREATE TABLE public.consumer_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  pod_code text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note text,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumer_applications_status_idx ON public.consumer_applications(status);
CREATE UNIQUE INDEX consumer_applications_one_pending_per_user ON public.consumer_applications(user_id) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumer_applications TO authenticated;
GRANT ALL ON public.consumer_applications TO service_role;

ALTER TABLE public.consumer_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own applications"
  ON public.consumer_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','supply_manager']::app_role[]));

CREATE POLICY "Admins/supply can decide"
  ON public.consumer_applications FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','supply_manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','supply_manager']::app_role[]));

-- Inserts happen via the link-consumer-pod edge function (service role); no direct insert policy for authenticated.

CREATE TRIGGER consumer_applications_updated_at
  BEFORE UPDATE ON public.consumer_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
