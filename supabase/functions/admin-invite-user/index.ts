// Admin-only: invite a new staff member by email and assign a role.
// verify_jwt = true; caller must have the 'admin' role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES = new Set(['admin','management','trader','supply_manager','billing_officer','finance','risk_officer','operations','auditor']);

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
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "").trim();
    const redirectTo = String(body.redirect_to ?? "") || undefined;
    if (!email || !email.includes("@")) return json({ error: "Valid email required" }, 400);
    if (!ROLES.has(role)) return json({ error: "Invalid role" }, 400);

    let userId: string | null = null;

    const invited = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
    if (invited.error) {
      // Likely already registered — look up existing user by email.
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = list.data.users.find(u => (u.email ?? "").toLowerCase() === email);
      if (!found) return json({ error: invited.error.message }, 500);
      userId = found.id;
    } else {
      userId = invited.data.user?.id ?? null;
    }
    if (!userId) return json({ error: "Could not resolve invited user" }, 500);

    const { error: rErr } = await admin.from("user_roles").insert({ user_id: userId, role }).select().maybeSingle();
    // Ignore duplicate role conflicts (unique constraint) — that's fine.
    if (rErr && !/duplicate|unique/i.test(rErr.message)) return json({ error: rErr.message }, 500);

    return json({ ok: true, user_id: userId, invited: !invited.error });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}