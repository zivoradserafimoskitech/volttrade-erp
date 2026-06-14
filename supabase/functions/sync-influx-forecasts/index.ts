// Edge function: pull daily consumption forecasts from InfluxDB Cloud v2
// and upsert them into public.forecasts.forecast_mwh_external.
// Mapping: InfluxDB tag `edu_code` → metering_points.edu_code → client_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type FluxRow = { edu_code: string; date: string; mwh: number };

function csvParse(text: string): Record<string, string>[] {
  // Minimal CSV parser for Flux annotated CSV (skip annotation lines starting with #)
  const lines = text.split(/\r?\n/).filter(l => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const INFLUX_URL = Deno.env.get("INFLUX_URL");
    const INFLUX_ORG = Deno.env.get("INFLUX_ORG");
    const INFLUX_BUCKET = Deno.env.get("INFLUX_BUCKET");
    const INFLUX_TOKEN = Deno.env.get("INFLUX_TOKEN");
    const INFLUX_MEASUREMENT = Deno.env.get("INFLUX_MEASUREMENT") ?? "consumption_forecast";

    if (!INFLUX_URL || !INFLUX_ORG || !INFLUX_BUCKET || !INFLUX_TOKEN) {
      return new Response(JSON.stringify({
        ok: false,
        error: "InfluxDB not configured. Add secrets INFLUX_URL, INFLUX_ORG, INFLUX_BUCKET, INFLUX_TOKEN (and optionally INFLUX_MEASUREMENT) in backend settings.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Auth: identify the calling user
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Service client for DB writes (RLS bypass) — still scoped by user_id in payloads
    const admin = createClient(supabaseUrl, supabaseService);

    // 1) Load metering points for this user with their edu_code → client_id mapping
    const { data: mps, error: mpErr } = await admin
      .from("metering_points")
      .select("edu_code, client_id, clients!inner(user_id)")
      .eq("clients.user_id", user.id);
    if (mpErr) throw mpErr;
    const eduToClient = new Map<string, string>();
    (mps ?? []).forEach((m: any) => { if (m.edu_code) eduToClient.set(String(m.edu_code), m.client_id); });
    const eduCodes = Array.from(eduToClient.keys());
    if (eduCodes.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0, message: "No metering points with EDU codes found." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Build Flux query — daily sum of forecast values per edu_code over the next 90 days
    const eduFilter = eduCodes.map(c => `r.edu_code == "${c.replace(/"/g, "")}"`).join(" or ");
    const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: now(), stop: 90d)
  |> filter(fn: (r) => r._measurement == "${INFLUX_MEASUREMENT}")
  |> filter(fn: (r) => r._field == "mwh" or r._field == "value")
  |> filter(fn: (r) => ${eduFilter})
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false)
  |> keep(columns: ["_time", "_value", "edu_code"])
`;

    const url = `${INFLUX_URL.replace(/\/$/, "")}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${INFLUX_TOKEN}`,
        "Content-Type": "application/vnd.flux",
        Accept: "application/csv",
      },
      body: flux,
    });
    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ ok: false, error: `InfluxDB query failed [${resp.status}]: ${text.slice(0, 500)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const csv = await resp.text();
    const rows = csvParse(csv);

    // 3) Build upsert payload
    const now = new Date().toISOString();
    const upserts: any[] = [];
    for (const row of rows) {
      const edu = row["edu_code"];
      const t = row["_time"];
      const v = Number(row["_value"]);
      if (!edu || !t || !isFinite(v)) continue;
      const clientId = eduToClient.get(edu);
      if (!clientId) continue;
      const date = t.slice(0, 10);
      upserts.push({
        user_id: user.id,
        client_id: clientId,
        forecast_date: date,
        forecast_mwh: 0, // do not override internal forecast on insert
        forecast_mwh_external: +v.toFixed(4),
        external_source: "influxdb",
        external_synced_at: now,
        method: "manual",
      });
    }

    if (upserts.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0, message: "InfluxDB returned no matching rows." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Upsert in chunks — on conflict only touch external columns (keep manual forecast_mwh intact)
    // We rely on UNIQUE(user_id, client_id, forecast_date). To preserve existing forecast_mwh,
    // we first fetch existing rows then build update/insert separately.
    const dates = Array.from(new Set(upserts.map(u => u.forecast_date)));
    const clientIds = Array.from(new Set(upserts.map(u => u.client_id)));
    const { data: existing } = await admin
      .from("forecasts")
      .select("id, client_id, forecast_date, forecast_mwh")
      .eq("user_id", user.id)
      .in("client_id", clientIds)
      .in("forecast_date", dates);
    const existIndex = new Map<string, { id: string; forecast_mwh: number }>();
    (existing ?? []).forEach((e: any) => existIndex.set(`${e.client_id}|${e.forecast_date}`, { id: e.id, forecast_mwh: Number(e.forecast_mwh) }));

    const toInsert: any[] = [];
    const toUpdate: { id: string; patch: any }[] = [];
    for (const u of upserts) {
      const k = `${u.client_id}|${u.forecast_date}`;
      const e = existIndex.get(k);
      if (e) {
        toUpdate.push({ id: e.id, patch: {
          forecast_mwh_external: u.forecast_mwh_external,
          external_source: u.external_source,
          external_synced_at: u.external_synced_at,
        }});
      } else {
        toInsert.push({ ...u, forecast_mwh: 0 });
      }
    }

    if (toInsert.length > 0) {
      const { error } = await admin.from("forecasts").insert(toInsert);
      if (error) throw error;
    }
    // Batch updates one by one (typical sync is small)
    for (const u of toUpdate) {
      const { error } = await admin.from("forecasts").update(u.patch).eq("id", u.id);
      if (error) throw error;
    }

    return new Response(JSON.stringify({
      ok: true,
      synced: upserts.length,
      inserted: toInsert.length,
      updated: toUpdate.length,
      meters: eduCodes.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("sync-influx-forecasts error:", err);
    return new Response(JSON.stringify({ ok: false, error: err?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});