CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec_id uuid;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN rec_id := (to_jsonb(OLD)->>'id')::uuid;
    ELSE rec_id := (to_jsonb(NEW)->>'id')::uuid; END IF;
  EXCEPTION WHEN others THEN rec_id := NULL;
  END;

  INSERT INTO public.audit_log (table_name, record_id, action, user_id, before_data, after_data)
  VALUES (
    TG_TABLE_NAME,
    rec_id,
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','invoices','payments','tariffs','supply_contracts',
    'trades','trading_contracts','counterparties','metering_points'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
      t
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_table_created ON public.audit_log (table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON public.audit_log (record_id);