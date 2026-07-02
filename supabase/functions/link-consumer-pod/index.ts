// Self-signup consumer links their auth user to a client by proving they know
// the POD/EIC code AND the email on the client record matches their auth email.
// Requires an authenticated request (verify_jwt = true).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes.user) return json({ error: "Invalid session" }, 401);
    const user = userRes.user;

    const body = await req.json().catch(() => ({}));
    const podRaw = String(body.pod_code ?? "").trim();
    if (!podRaw) return json({ error: "Missing POD/EIC code" }, 400);
    const pod = podRaw.toUpperCase();

    // Find the metering point (match by pod_code OR eic_code, case-insensitive).
    const { data: mps, error: mpErr } = await admin
      .from("metering_points")
      .select("id, client_id, pod_code, eic_code")
      .or(`pod_code.ilike.${pod},eic_code.ilike.${pod}`)
      .limit(1);
    if (mpErr) return json({ error: mpErr.message }, 500);
    const mp = mps?.[0];
    if (!mp?.client_id) return json({ error: "No supply point matches that code" }, 404);

    const { data: client, error: cErr } = await admin
      .from("clients")
      .select("id, contact_email, portal_user_id")
      .eq("id", mp.client_id)
      .maybeSingle();
    if (cErr) return json({ error: cErr.message }, 500);
    if (!client) return json({ error: "Customer record not found" }, 404);

    if (client.portal_user_id && client.portal_user_id !== user.id) {
      return json({ error: "This supply point is already linked to another account. Contact support." }, 409);
    }

    const userEmail = (user.email ?? "").toLowerCase();
    const clientEmail = (client.contact_email ?? "").toLowerCase();
    if (!clientEmail || clientEmail !== userEmail) {
      return json({ error: "The email on your account doesn't match the email on this supply point. Contact your supplier to update it, or ask them to invite you." }, 403);
    }

    if (!client.portal_user_id) {
      const { error: upErr } = await admin.from("clients").update({ portal_user_id: user.id }).eq("id", client.id);
      if (upErr) return json({ error: upErr.message }, 500);
    }
    return json({ ok: true, client_id: client.id });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}