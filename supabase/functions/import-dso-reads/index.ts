// Ingest DSO/EVN certified meter reads (DSO_MONTHLY / DSO_INTERVAL) with
// import-time validation: unknown points, negative/non-numeric, physically
// implausible and duplicate rows are REJECTED and reported, never inserted.
// Corrections require explicit allow_overwrite:true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Require an authenticated admin/operations user
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
  const { data: allowed } = await userClient.rpc("has_any_role", { _user_id: u.user.id, _roles: ["admin", "operations", "billing_officer"] });
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({} as any));
  // Real payload: rows = [{ edu_code | metering_point_id, reading_at (ISO) | month (YYYY-MM),
  //                         kwh, type?: "MONTHLY"|"INTERVAL" }]
  // Every row passes import-VEE; rejected rows are returned with reasons, never inserted.
  const inputRows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!inputRows.length) {
    return new Response(JSON.stringify({ ok: false, error: "rows[] is required: { edu_code|metering_point_id, reading_at|month, kwh, type? }" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
  const allowOverwrite = body.allow_overwrite === true; // DSO corrections: explicit opt-in

  // Resolve metering points (by id or EDU code) + physical limits
  const { data: mps } = await supabase.from("metering_points").select("id, edu_code, connected_power_kw");
  const byId = new Map<string, any>(); const byEdu = new Map<string, any>();
  (mps ?? []).forEach((m: any) => { byId.set(m.id, m); if (m.edu_code) byEdu.set(String(m.edu_code), m); });

  const accepted: any[] = []; const rejected: any[] = []; const warnings: any[] = [];
  for (let i = 0; i < inputRows.length; i++) {
    const r = inputRows[i];
    const mp = r.metering_point_id ? byId.get(r.metering_point_id) : byEdu.get(String(r.edu_code ?? ""));
    if (!mp) { rejected.push({ i, reason: "unknown metering point", row: r }); continue; }
    const kwh = Number(r.kwh);
    if (!isFinite(kwh)) { rejected.push({ i, reason: "kwh not numeric", row: r }); continue; }
    if (kwh < 0) { rejected.push({ i, reason: "negative kwh", row: r }); continue; }
    const isInterval = String(r.type ?? "MONTHLY").toUpperCase() === "INTERVAL";
    const readingAt = r.reading_at ?? (r.month ? `${r.month}-01T00:00:00Z` : null);
    if (!readingAt || isNaN(Date.parse(readingAt))) { rejected.push({ i, reason: "invalid reading_at/month", row: r }); continue; }
    // Physical plausibility: monthly ≤ P × 744h × 1.2 ; hourly ≤ P × 1.2
    const pKw = Number(mp.connected_power_kw || 0);
    if (pKw > 0) {
      const maxKwh = isInterval ? pKw * 1.2 : pKw * 744 * 1.2;
      if (kwh > maxKwh) { rejected.push({ i, reason: `implausible: ${kwh} kWh > ${maxKwh.toFixed(0)} kWh physical max for ${pKw} kW`, row: r }); continue; }
    }
    accepted.push({
      metering_point_id: mp.id,
      reading_at: new Date(readingAt).toISOString(),
      actual_mwh: kwh / 1000,
      source: isInterval ? "DSO_INTERVAL" : "DSO_MONTHLY",
      settlement_relevant: true,
      is_estimated: false,
      quality: "measured",
    });
  }

  // Duplicate check against existing DSO rows (same point + timestamp)
  let inserted = 0, overwritten = 0;
  if (accepted.length) {
    const mpIds = [...new Set(accepted.map(a => a.metering_point_id))];
    const times = [...new Set(accepted.map(a => a.reading_at))];
    const { data: existing } = await supabase.from("consumption_readings")
      .select("id, metering_point_id, reading_at, actual_mwh")
      .in("metering_point_id", mpIds).in("reading_at", times)
      .in("source", ["DSO_MONTHLY", "DSO_INTERVAL"]);
    const exKey = new Map<string, any>();
    (existing ?? []).forEach((e: any) => exKey.set(`${e.metering_point_id}|${new Date(e.reading_at).toISOString()}`, e));
    const fresh: any[] = [];
    for (const a of accepted) {
      const ex = exKey.get(`${a.metering_point_id}|${a.reading_at}`);
      if (!ex) { fresh.push(a); continue; }
      if (allowOverwrite) {
        const { error } = await supabase.from("consumption_readings").update({ actual_mwh: a.actual_mwh, is_estimated: false, quality: "measured" }).eq("id", ex.id);
        if (!error) { overwritten++; warnings.push({ reason: `corrected existing DSO read (${(ex.actual_mwh * 1000).toFixed(0)} → ${(a.actual_mwh * 1000).toFixed(0)} kWh)`, metering_point_id: a.metering_point_id, reading_at: a.reading_at }); }
      } else {
        rejected.push({ reason: "duplicate of existing DSO read (pass allow_overwrite:true for corrections)", metering_point_id: a.metering_point_id, reading_at: a.reading_at });
      }
    }
    if (fresh.length) {
      const { error, count } = await supabase.from("consumption_readings").insert(fresh, { count: "exact" });
      if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
      inserted = count ?? fresh.length;
    }
  }
  return new Response(JSON.stringify({ ok: true, inserted, overwritten, rejected_count: rejected.length, rejected, warnings }), { headers: { ...corsHeaders, "content-type": "application/json" } });
});