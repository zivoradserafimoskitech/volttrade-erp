-- NOTE 2026-09-03 (audit): this is a one-off assertion that pins the md5 of a
-- live credential. It will start failing the moment that key is rotated, and a
-- migration that fails on key rotation is a migration that blocks every future
-- deploy. Consider deleting it now that the cron 401s are fixed.
do $$
declare v text;
begin
  -- REPAIR 2026-09-03: `vault` is Supabase-only. Skip on a server without it
  -- (CI) rather than aborting the migration chain; on Supabase the checks below
  -- still run exactly as written.
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'vault not available — skipping';
    return;
  end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = 'email_queue_service_role_key';
  if v is null then
    raise exception 'MISSING secret';
  elsif md5(v) <> 'bac54a2e4fe458b27efc5075c4d3f6f6' then
    raise exception 'STALE secret: length=%, md5=%', length(v), md5(v);
  end if;
end $$;