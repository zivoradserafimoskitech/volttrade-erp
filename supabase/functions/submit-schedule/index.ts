// Stub: TSO schedule submission (MAVIR / MEPSO). Generates a fake ack id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } });
  const { data: allowed } = await userClient.rpc("has_any_role", { _user_id: u.user.id, _roles: ["admin", "operations", "trader"] });
  if (!allowed) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });

  const body = await req.json().catch(() => ({} as any));
  const ack = `ACK-${Date.now().toString(36).toUpperCase()}`;
  console.log("submit-schedule stub for user", u.user.id);
  return new Response(JSON.stringify({ ok: true, ack, echo: body, submitted_at: new Date().toISOString() }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});