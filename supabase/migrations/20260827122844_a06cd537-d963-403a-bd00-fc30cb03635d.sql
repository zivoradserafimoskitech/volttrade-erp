ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS eic_code text,
  ADD COLUMN IF NOT EXISTS address_line text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS swift text,
  ADD COLUMN IF NOT EXISTS licence_number text,
  ADD COLUMN IF NOT EXISTS invoice_sender_email text,
  ADD COLUMN IF NOT EXISTS invoice_footer_note text,
  ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

GRANT UPDATE ON public.organizations TO authenticated;

DROP POLICY IF EXISTS "admins update their organization" ON public.organizations;
CREATE POLICY "admins update their organization"
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_member(id) AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.is_org_member(id) AND public.has_role(auth.uid(), 'admin'));