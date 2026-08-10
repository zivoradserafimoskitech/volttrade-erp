ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dunning_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_dunning_at timestamptz,
  ADD COLUMN IF NOT EXISTS notice_language text;

CREATE TABLE IF NOT EXISTS public.invoice_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invoice','reminder','dunning')),
  dunning_level integer NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'portal',
  language text NOT NULL DEFAULT 'mk',
  recipient text,
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_dispatches_invoice ON public.invoice_dispatches(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_dispatches_client ON public.invoice_dispatches(client_id);

GRANT SELECT ON public.invoice_dispatches TO authenticated;
GRANT ALL ON public.invoice_dispatches TO service_role;

ALTER TABLE public.invoice_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read invoice dispatches"
ON public.invoice_dispatches FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','management','billing_officer','finance','operations','auditor']::app_role[]));

CREATE POLICY "Portal user reads own invoice dispatches"
ON public.invoice_dispatches FOR SELECT TO authenticated
USING (client_id = public.current_portal_client_id());