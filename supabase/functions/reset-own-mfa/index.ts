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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identify the caller with an anon client carrying their token (never sign in on the admin client).
    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: me } = await authClient.auth.getUser(token);

    const body = await req.json().catch(() => ({}));
    const password = String(body.password ?? "");
    const email = String(me.user?.email ?? body.email ?? "").trim().toLowerCase();
    if (!email) {
      return json({ error: "Your session has expired. Enter your account email and password to reset 2FA." }, 401);
    }
    if (!password) return json({ error: "Current password is required" }, 400);

    // Password is the proof of identity — works even when the access token is stale.
    const pwClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: pwData, error: signInErr } = await pwClient.auth.signInWithPassword({ email, password });
    if (signInErr || !pwData.user) return json({ error: "Incorrect email or password" }, 403);
    const userId = me.user?.id ?? pwData.user.id;

    // Opaque secret keys must be sent as apikey only; legacy JWT keys also accept Bearer.
    const adminHeaders: Record<string, string> = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };

    const listRes = await fetch(`${url}/auth/v1/admin/users/${userId}/factors`, {
      headers: adminHeaders,
    });
    if (!listRes.ok) {
      const detail = await listRes.text();
      console.error("list factors failed", listRes.status, detail);
      return json({ error: `Could not list MFA factors (${listRes.status})` }, 500);
    }
    const payload = await listRes.json();
    const factors: any[] = Array.isArray(payload) ? payload : (payload?.factors ?? []);

    for (const factor of factors) {
      const delRes = await fetch(`${url}/auth/v1/admin/users/${userId}/factors/${factor.id}`, {
        method: "DELETE",
        headers: adminHeaders,
      });
      if (!delRes.ok) console.error("delete factor failed", factor.id, await delRes.text());
    }

    return json({ ok: true, removed: factors.length });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
