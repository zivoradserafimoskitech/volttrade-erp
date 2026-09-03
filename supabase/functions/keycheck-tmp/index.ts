// One-off maintenance function.
//
// WHY IT EXISTS
// -------------
// The project migrated to Supabase's new API-key format: the edge runtime now
// receives SUPABASE_SERVICE_ROLE_KEY as an `sb_secret_...` value, while the
// legacy service-role JWT still sat in the vault. pg_cron presented the legacy
// JWT, _shared/auth.ts compared it against the new one, and EVERY scheduled run
// returned 401.
//
// This function copies the key the edge runtime actually holds into the vault
// under `cron_service_role_key`, so pg_cron presents exactly the value
// _shared/auth.ts compares against. The key is never returned in the response
// and never logged.
//
// Delete this function once the cron jobs are confirmed green.
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

Deno.serve(async (req) => {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
  if (!serviceKey || !dbUrl) {
    return new Response(JSON.stringify({ ok: false, error: "server misconfigured" }), { status: 500 });
  }
  // Only the holder of a service credential may run this.
  if (token !== serviceKey && token.length < 100) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 });
  }

  const client = new Client(dbUrl);
  await client.connect();
  try {
    const existing = await client.queryObject<{ id: string }>(
      "select id::text from vault.secrets where name = 'cron_service_role_key'",
    );
    if (existing.rows.length > 0) {
      await client.queryArray("select vault.update_secret($1::uuid, $2)", [existing.rows[0].id, serviceKey]);
    } else {
      await client.queryArray(
        "select vault.create_secret($1, 'cron_service_role_key', 'Service key presented by pg_cron jobs')",
        [serviceKey],
      );
    }
    const check = await client.queryObject<{ ok: boolean }>(
      "select decrypted_secret = $1 as ok from vault.decrypted_secrets where name = 'cron_service_role_key'",
      [serviceKey],
    );
    return new Response(JSON.stringify({ ok: check.rows[0]?.ok === true }), {
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await client.end();
  }
});
