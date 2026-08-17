ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tariff_id uuid REFERENCES public.tariffs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_override boolean NOT NULL DEFAULT false;

UPDATE public.clients SET price_override = true
 WHERE fixed_price_eur_mwh IS NOT NULL AND tariff_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_tariff_id ON public.clients(tariff_id);