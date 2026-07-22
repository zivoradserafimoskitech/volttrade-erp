-- Public lead capture from the Vatra landing page (anonymous, no auth).
-- Leads are created via the submit-lead edge function (service role), so we
-- do NOT open a public INSERT policy on the table itself — the function is the
-- only writer. Add a couple of fields the landing form collects.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS consumer_type text,   -- household | business
  ADD COLUMN IF NOT EXISTS tax_id text,          -- filled later (contract stage), not at landing
  ADD COLUMN IF NOT EXISTS pod_code text;        -- filled later, not at landing

-- Staff visibility already governed by earlier RLS; ensure staff can read/manage.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS "auth manage leads" ON public.leads';
  EXECUTE 'CREATE POLICY "staff manage leads" ON public.leads FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())';
EXCEPTION WHEN others THEN NULL;
END $$;
