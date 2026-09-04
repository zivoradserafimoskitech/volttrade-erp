// Edge function: pull daily consumption forecasts from InfluxDB Cloud v2
// and upsert them into public.forecasts.forecast_mwh_external.
// Mapping: InfluxDB tag `edu_code` → metering_points.edu_code → client_id.
//
// ── PHASE 3 STATUS — READ BEFORE TOUCHING ──────────────────────────────────
//
// 1. INFLUXDB IS NOT FULLY RETIRED, AND THAT IS CORRECT.
//    Phase 3 retired InfluxDB for ASSET TELEMETRY (sync-asset-telemetry),
//    because that data duplicated what the gateway platform already ingests.
//    THIS function is different: it pulls a third-party forecasting provider's
//    output. The gateway does not produce forecasts and cannot replace it, so
//    InfluxDB remains a dependency for this feed alone.
//
// 2. P0-3 AUTH — FIXED IN PHASE 4.
//    Phase 3 deliberately left this broken: it both WROTE `user_id` into
//    public.forecasts and FILTERED deletes by it, so accepting a service-role
//    caller (no user id) would have inserted NULL user_ids and run a delete
//    filtered on NULL — worse than an honest 401.
//
//    Phase 4 made that safe. `forecasts.user_id` is now `created_by`
//    (nullable, defaulted to auth.uid()), ownership moved to
//    `organization_id`, and the delete is scoped by organization instead of by
//    person. Scheduled runs work.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";
import { authenticate } from "../_shared/auth.ts";

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
    // Accepts EITHER a staff JWT or the service-role key (pg_cron).
    const auth = await authenticate(req, {
      roles: ["admin", "management", "operations", "trading"],
    });
    const admin = auth.admin;

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


    // Ownership is the organization, not the caller. A service-role run has no
    // user, so resolve the org directly rather than through current_org_id().
    const { data: orgRow, error: orgErr } = await admin
      .from("organizations")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (!orgRow) {
      return new Response(JSON.stringify({ ok: false, error: "No organization configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const organizationId = orgRow.id as string;

    // 1) Load metering points for this user with their edu_code → client_id mapping
    const { data: mps, error: mpErr } = await admin
      .from("metering_points")
      .select("edu_code, client_id, clients!inner(organization_id)")
      .eq("clients.organization_id", organizationId);
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
        organization_id: organizationId,
        created_by: auth.userId, // null on scheduled runs — intended
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

    // Upsert in chunks — on conflict only touch external columns (keep manual
    // forecast_mwh intact). Phase 4 re-keyed the constraint to
    // UNIQUE(organization_id, client_id, forecast_date): it was
    // UNIQUE(user_id, ...), which after the created_by rename would have been
    // nullable and stopped deduplicating scheduled runs entirely.
    const dates = Array.from(new Set(upserts.map(u => u.forecast_date)));
    const clientIds = Array.from(new Set(upserts.map(u => u.client_id)));
    const { data: existing } = await admin
      .from("forecasts")
      .select("id, client_id, forecast_date, forecast_mwh")
      .eq("organization_id", organizationId)
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
    const status = err instanceof AuthError ? err.status : 500;
    return new Response(JSON.stringify({ ok: false, error: err?.message ?? "Unknown error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});