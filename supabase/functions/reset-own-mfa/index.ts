// Self-service MFA reset for a logged-in staff user.
// Requires the user's current password to prove identity, then deletes all TOTP factors.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !me.user) return json({ error: "Invalid session" }, 401);

    const body = await req.json().catch(() => ({}));
    const password = String(body.password ?? "");
    if (!password) return json({ error: "Current password is required" }, 400);

    // Re-authenticate with password to prove identity.
    const { error: signInErr } = await admin.auth.signInWithPassword({
      email: me.user.email!,
      password,
    });
    if (signInErr) return json({ error: "Incorrect password" }, 403);

    // List and delete all MFA factors for this user via GoTrue admin API.
    const listRes = await fetch(`${url}/auth/v1/admin/users/${me.user.id}/factors`, {
      headers: { "Authorization": `Bearer ${service}`, "apikey": service },
    });
    if (!listRes.ok) return json({ error: "Could not list MFA factors" }, 500);
    const factors = (await listRes.json()) as any[] ?? [];

    for (const factor of factors) {
      await fetch(`${url}/auth/v1/admin/users/${me.user.id}/factors/${factor.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${service}`, "apikey": service },
      });
    }

    return json({ ok: true, removed: factors.length });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
