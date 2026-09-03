-- REPAIR 2026-09-01: each statement is now guarded on the function existing.
-- The email helpers are created by 20260811133115_email_infra.sql only when
-- pgmq / pg_net are present, so on a plain Postgres (CI) this file aborted the
-- chain. On Supabase every function exists and behaviour is unchanged.

-- Pin search_path on email queue helper functions
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;

-- These are internal (service_role / cron / trigger) helpers: revoke public execute
DO $g$ BEGIN IF to_regprocedure('public.delete_email(text, bigint)') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.enqueue_email(text, jsonb)') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.move_to_dlq(text, text, bigint, jsonb)') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.read_email_batch(text, integer, integer)') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.email_queue_dispatch()') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.email_queue_wake()') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated'; END IF; END $g$;

DO $g$ BEGIN IF to_regprocedure('public.delete_email(text, bigint)') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.enqueue_email(text, jsonb)') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.move_to_dlq(text, text, bigint, jsonb)') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.read_email_batch(text, integer, integer)') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.email_queue_dispatch()') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role'; END IF; END $g$;
DO $g$ BEGIN IF to_regprocedure('public.email_queue_wake()') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.email_queue_wake() TO service_role'; END IF; END $g$;