-- Repairs for databases already migrated before 2026-09-01.
--
-- The from-scratch replay fixes live in the original migration files (they
-- could never have applied as written, so editing them changes nothing for an
-- existing database). This file carries the two corrections that an already-
-- migrated database still needs, and is safe to run repeatedly.

-- 1. 'MK' was absent from the countries seed. Anything FK-referencing
--    countries(code) with 'MK' -- organizations, clients, metering points --
--    could not be inserted.
INSERT INTO public.countries(code, name, currency, vat_percent, tso_code)
VALUES ('MK', 'North Macedonia', 'MKD', 18, 'MEPSO')
ON CONFLICT (code) DO NOTHING;

-- 2. Ensure the tenant organisation exists now that its country_code resolves.
INSERT INTO public.organizations (id, name, legal_name, country_code)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'Vatra', 'Vatra', 'MK'
WHERE NOT EXISTS (SELECT 1 FROM public.organizations);
