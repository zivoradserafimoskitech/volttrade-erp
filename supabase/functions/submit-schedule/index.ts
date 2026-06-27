// Stub: TSO schedule submission (MAVIR / MEPSO). Generates a fake ack id.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await req.json().catch(() => ({} as any));
  const ack = `ACK-${Date.now().toString(36).toUpperCase()}`;
  console.log("submit-schedule stub", body);
  return new Response(JSON.stringify({ ok: true, ack, echo: body, submitted_at: new Date().toISOString() }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});