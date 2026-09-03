do $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'email_queue_service_role_key';
  if v is null then
    raise exception 'MISSING secret';
  elsif md5(v) <> 'bac54a2e4fe458b27efc5075c4d3f6f6' then
    raise exception 'STALE secret: length=%, md5=%', length(v), md5(v);
  end if;
end $$;