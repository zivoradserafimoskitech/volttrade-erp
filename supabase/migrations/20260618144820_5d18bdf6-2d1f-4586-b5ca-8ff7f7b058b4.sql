-- REPAIR 2026-09-01: CREATE EXTENSION wrapped so a plain Postgres (CI) can
-- replay the chain. On Supabase the extensions exist and this is a no-op.
DO $ext$ BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'skipping: % (not available on this server)', 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;';
END $ext$;
DO $ext$ BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'skipping: % (not available on this server)', 'CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;';
END $ext$;