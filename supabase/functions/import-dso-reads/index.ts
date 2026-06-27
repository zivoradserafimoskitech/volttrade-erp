// Stub: ingest DSO certified meter reads (DSO_MONTHLY / DSO_INTERVAL).
// Mock payload generator — inserts a handful of settlement-relevant rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({} as any));
  // Demo: synthesize a few rows. In production, parse DSO file/API payload here.
  const points = body.metering_point_ids ?? [];
  const month = body.month ?? new Date().toISOString().slice(0, 7);
  const rows = points.map((mp: string, i: number) => ({
    metering_point_id: mp,
    reading_at: `${month}-01T00:00:00Z`,
    kwh: 1000 + i * 250,
    source: "DSO_MONTHLY",
    settlement_relevant: true,
    is_estimated: false,
  }));
  let inserted = 0;
  if (rows.length) {
    const { error, count } = await supabase.from("consumption_readings").insert(rows, { count: "exact" });
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
    inserted = count ?? rows.length;
  }
  return new Response(JSON.stringify({ ok: true, inserted, month }), { headers: { ...corsHeaders, "content-type": "application/json" } });
});