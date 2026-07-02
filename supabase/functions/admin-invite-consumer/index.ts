// Staff-invites-consumer flow: invites a consumer by email and links the
// created auth user to the target client (portal_user_id). Requires admin or
// supply_manager role.

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

    const { data: allowed } = await admin.rpc("has_any_role", { _user_id: me.user.id, _roles: ["admin", "supply_manager"] });
    if (!allowed) return json({ error: "Not authorized" }, 403);

    const body = await req.json().catch(() => ({}));
    const clientId = String(body.client_id ?? "").trim();
    const emailOverride = String(body.email ?? "").trim().toLowerCase();
    const redirectTo = String(body.redirect_to ?? "") || undefined;
    if (!clientId) return json({ error: "client_id required" }, 400);

    const { data: client, error: cErr } = await admin
      .from("clients")
      .select("id, contact_email, portal_user_id, company_name")
      .eq("id", clientId).maybeSingle();
    if (cErr) return json({ error: cErr.message }, 500);
    if (!client) return json({ error: "Client not found" }, 404);

    const email = emailOverride || (client.contact_email ?? "").toLowerCase();
    if (!email.includes("@")) return json({ error: "No contact email on this client — pass one explicitly." }, 400);

    let userId: string | null = null;
    const invited = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
    if (invited.error) {
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = list.data.users.find(u => (u.email ?? "").toLowerCase() === email);
      if (!found) return json({ error: invited.error.message }, 500);
      userId = found.id;
    } else {
      userId = invited.data.user?.id ?? null;
    }
    if (!userId) return json({ error: "Could not resolve invited user" }, 500);

    if (!client.portal_user_id) {
      const { error: upErr } = await admin.from("clients").update({ portal_user_id: userId, contact_email: email }).eq("id", client.id);
      if (upErr) return json({ error: upErr.message }, 500);
    }
    return json({ ok: true, user_id: userId, invited: !invited.error });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}