// Admin-only: reset MFA for another user by user_id.
// verify_jwt = true; caller must have the 'admin' role.

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

    const { data: adminCheck } = await admin.rpc("has_role", { _user_id: me.user.id, _role: "admin" });
    if (!adminCheck) return json({ error: "Admin role required" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body.user_id ?? "").trim();
    if (!targetUserId) return json({ error: "user_id is required" }, 400);

    const listRes = await fetch(`${url}/auth/v1/admin/users/${targetUserId}/factors`, {
      headers: { "Authorization": `Bearer ${service}`, "apikey": service },
    });
    if (!listRes.ok) return json({ error: "Could not list MFA factors" }, 500);
    const factors = (await listRes.json()) as any[] ?? [];

    for (const factor of factors) {
      await fetch(`${url}/auth/v1/admin/users/${targetUserId}/factors/${factor.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${service}`, "apikey": service },
      });
    }

    return json({ ok: true, user_id: targetUserId, removed: factors.length });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
