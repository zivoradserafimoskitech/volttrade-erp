// Admin/supply-manager approves or rejects a pending Vatra consumer application.
// On approval, sets clients.portal_user_id so the consumer can access the portal.

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

    const { data: userRes, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userRes.user) return json({ error: "Invalid session" }, 401);
    const uid = userRes.user.id;

    // Require admin or supply_manager role.
    const { data: roleOk } = await admin.rpc("has_any_role", { _user_id: uid, _roles: ["admin", "supply_manager"] });
    if (!roleOk) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const applicationId = String(body.application_id ?? "");
    const decision = String(body.decision ?? ""); // 'approve' | 'reject'
    const note = body.note ? String(body.note).slice(0, 500) : null;
    if (!applicationId || !["approve", "reject"].includes(decision)) {
      return json({ error: "application_id and decision required" }, 400);
    }

    const { data: app, error: appErr } = await admin
      .from("consumer_applications")
      .select("id, user_id, client_id, status")
      .eq("id", applicationId).maybeSingle();
    if (appErr) return json({ error: appErr.message }, 500);
    if (!app) return json({ error: "Application not found" }, 404);
    if (app.status !== "pending") return json({ error: `Already ${app.status}` }, 409);

    if (decision === "approve") {
      if (!app.client_id) return json({ error: "Application has no linked client" }, 400);
      // Guard: don't overwrite an already-linked client.
      const { data: client } = await admin.from("clients").select("id, portal_user_id").eq("id", app.client_id).maybeSingle();
      if (!client) return json({ error: "Client no longer exists" }, 404);
      if (client.portal_user_id && client.portal_user_id !== app.user_id) {
        return json({ error: "Client is already linked to a different portal user" }, 409);
      }
      if (!client.portal_user_id) {
        const { error: linkErr } = await admin.from("clients").update({ portal_user_id: app.user_id }).eq("id", app.client_id);
        if (linkErr) return json({ error: linkErr.message }, 500);
      }
    }

    const { error: updErr } = await admin.from("consumer_applications")
      .update({ status: decision === "approve" ? "approved" : "rejected", decided_by: uid, decided_at: new Date().toISOString(), note })
      .eq("id", applicationId);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
}