// Pulls BESS / PV telemetry from InfluxDB Cloud v2 and upserts into
// public.asset_telemetry (history) + public.asset_telemetry_latest (live cache).
// Mapping: Influx tag `asset_code` -> public.assets.external_ref (or asset_code).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function csvParse(text: string): Record<string, string>[] {
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
    const INFLUX_BUCKET = Deno.env.get("INFLUX_ASSETS_BUCKET") ?? Deno.env.get("INFLUX_BUCKET");
    const INFLUX_TOKEN = Deno.env.get("INFLUX_TOKEN");
    const INFLUX_MEASUREMENT = Deno.env.get("INFLUX_ASSET_MEASUREMENT") ?? "asset_telemetry";

    if (!INFLUX_URL || !INFLUX_ORG || !INFLUX_BUCKET || !INFLUX_TOKEN) {
      return new Response(JSON.stringify({
        ok: false,
        error: "InfluxDB not configured. Add INFLUX_URL, INFLUX_ORG, INFLUX_BUCKET (or INFLUX_ASSETS_BUCKET), INFLUX_TOKEN.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    const admin = createClient(supabaseUrl, supabaseService);

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const windowMinutes = Math.min(Math.max(Number(body.window_minutes) || 60, 5), 60 * 24 * 7);

    // 1) Load assets for this user
    const { data: assets, error: aErr } = await admin
      .from("assets")
      .select("id, asset_code, external_ref, asset_type")
      .eq("user_id", user.id);
    if (aErr) throw aErr;
    const refToAsset = new Map<string, { id: string; type: string }>();
    (assets ?? []).forEach((a: any) => {
      const ref = (a.external_ref || a.asset_code || "").toString();
      if (ref) refToAsset.set(ref, { id: a.id, type: a.asset_type });
    });
    const refs = Array.from(refToAsset.keys());
    if (refs.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0, message: "No assets configured." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Flux query — last N minutes, pivot fields per asset_code, 1 minute aggregate
    const refFilter = refs.map(c => `r.asset_code == "${c.replace(/"/g, "")}"`).join(" or ");
    const flux = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -${windowMinutes}m)
  |> filter(fn: (r) => r._measurement == "${INFLUX_MEASUREMENT}")
  |> filter(fn: (r) => ${refFilter})
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  |> pivot(rowKey:["_time","asset_code"], columnKey: ["_field"], valueColumn: "_value")
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
      return new Response(JSON.stringify({ ok: false, error: `Influx query failed [${resp.status}]: ${text.slice(0, 500)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const rows = csvParse(await resp.text());

    const num = (v: string) => {
      const n = Number(v); return isFinite(n) ? n : null;
    };

    const history: any[] = [];
    const latestByAsset = new Map<string, any>();

    for (const row of rows) {
      const ref = row["asset_code"];
      const t = row["_time"];
      if (!ref || !t) continue;
      const a = refToAsset.get(ref);
      if (!a) continue;
      const rec = {
        user_id: user.id,
        asset_id: a.id,
        ts: t,
        power_kw: num(row["power_kw"] ?? ""),
        soc_pct: num(row["soc_pct"] ?? ""),
        energy_kwh: num(row["energy_kwh"] ?? ""),
        pv_generation_kwh: num(row["pv_generation_kwh"] ?? ""),
        pv_irradiance_w_m2: num(row["pv_irradiance_w_m2"] ?? ""),
        grid_kw: num(row["grid_kw"] ?? ""),
        load_kw: num(row["load_kw"] ?? ""),
        status: row["status"] || null,
        alarm_code: row["alarm_code"] || null,
        source: "influxdb",
      };
      history.push(rec);
      const prev = latestByAsset.get(a.id);
      if (!prev || new Date(rec.ts) > new Date(prev.ts)) latestByAsset.set(a.id, rec);
    }

    if (history.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0, message: "Influx returned no rows." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) Upsert history (chunked) on conflict (asset_id, ts)
    const chunkSize = 500;
    for (let i = 0; i < history.length; i += chunkSize) {
      const slice = history.slice(i, i + chunkSize);
      const { error } = await admin
        .from("asset_telemetry")
        .upsert(slice, { onConflict: "asset_id,ts" });
      if (error) throw error;
    }

    // 4) Upsert latest snapshot
    const latestRows = Array.from(latestByAsset.values()).map(r => ({
      asset_id: r.asset_id,
      user_id: r.user_id,
      ts: r.ts,
      power_kw: r.power_kw,
      soc_pct: r.soc_pct,
      pv_generation_kwh: r.pv_generation_kwh,
      grid_kw: r.grid_kw,
      load_kw: r.load_kw,
      status: r.status,
      alarm_code: r.alarm_code,
      updated_at: new Date().toISOString(),
    }));
    if (latestRows.length > 0) {
      const { error } = await admin
        .from("asset_telemetry_latest")
        .upsert(latestRows, { onConflict: "asset_id" });
      if (error) throw error;
    }

    return new Response(JSON.stringify({
      ok: true, synced: history.length, assets: latestRows.length, window_minutes: windowMinutes,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("sync-asset-telemetry error:", err);
    return new Response(JSON.stringify({ ok: false, error: err?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});