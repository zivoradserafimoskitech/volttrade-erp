// Sync meter reads from Enertrek/Kimi TimescaleDB (`telemetry` hypertable)
// into public.meter_readings (settlement-grade cumulative registers) and
// public.consumption_readings (interval kWh for charts).
//
// Mapping: telemetry.meter_id (bigint) -> metering_points.kimi_meter_id.
// Requires secret: TIMESCALE_URL (postgres://user:pass@host:5432/db?sslmode=require)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";
import { Client as PgClient } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const TIMESCALE_URL = Deno.env.get("TIMESCALE_URL");
    if (!TIMESCALE_URL) {
      return json({ ok: false, error: "TIMESCALE_URL not configured" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: "Not authenticated" }, 401);

    const admin = createClient(supabaseUrl, supabaseService);

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const windowMinutes = Math.min(Math.max(Number(body.window_minutes) || 60, 5), 60 * 24 * 7);
    const bucketMinutes = Math.min(Math.max(Number(body.bucket_minutes) || 60, 15), 1440);

    // 1) Load MPs owned by user that are linked to a Kimi meter
    const { data: mps, error: mpErr } = await admin
      .from("metering_points")
      .select("id, edu_code, kimi_meter_id, user_id")
      .eq("user_id", user.id)
      .not("kimi_meter_id", "is", null);
    if (mpErr) throw mpErr;

    const idMap = new Map<number, { id: string; edu_code: string }>();
    (mps ?? []).forEach((m: any) => idMap.set(Number(m.kimi_meter_id), { id: m.id, edu_code: m.edu_code }));
    const meterIds = Array.from(idMap.keys());
    if (meterIds.length === 0) {
      return json({ ok: true, synced: 0, message: "No metering points linked to Kimi meters." });
    }

    // 2) Connect to Timescale
    const pg = new PgClient(TIMESCALE_URL);
    await pg.connect();

    // Latest cumulative register per meter (for meter_readings)
    const latestSql = `
      SELECT DISTINCT ON (meter_id) meter_id, ts,
             energy_import_kwh, energy_export_kwh
      FROM telemetry
      WHERE meter_id = ANY($1::bigint[])
        AND ts >= now() - ($2 || ' minutes')::interval
      ORDER BY meter_id, ts DESC
    `;
    const latest = await pg.queryObject<{
      meter_id: bigint; ts: Date; energy_import_kwh: number | null; energy_export_kwh: number | null;
    }>(latestSql, [meterIds, String(windowMinutes)]);

    // Interval consumption via bucketed max−min of cumulative registers
    const intervalSql = `
      SELECT meter_id,
             time_bucket($3::interval, ts) AS bucket,
             MAX(energy_import_kwh) - MIN(energy_import_kwh) AS import_kwh,
             MAX(energy_export_kwh) - MIN(energy_export_kwh) AS export_kwh,
             AVG(active_power_kw) AS avg_power_kw
      FROM telemetry
      WHERE meter_id = ANY($1::bigint[])
        AND ts >= now() - ($2 || ' minutes')::interval
      GROUP BY meter_id, bucket
      ORDER BY bucket
    `;
    const intervals = await pg.queryObject<{
      meter_id: bigint; bucket: Date; import_kwh: number | null; export_kwh: number | null; avg_power_kw: number | null;
    }>(intervalSql, [meterIds, String(windowMinutes), `${bucketMinutes} minutes`]);

    await pg.end();

    // 3) Upsert cumulative reads → meter_readings (settlement-grade)
    const readingRows = latest.rows.map(r => {
      const mp = idMap.get(Number(r.meter_id))!;
      return {
        metering_point_id: mp.id,
        reading_at: new Date(r.ts).toISOString(),
        import_kwh: r.energy_import_kwh ?? 0,
        export_kwh: r.energy_export_kwh ?? 0,
        source: "api",
        validation_status: "pending",
        created_by: user.id,
        notes: "Auto-synced from Kimi/Enertrek Timescale — awaiting VEE",
      };
    });
    let readingsInserted = 0;
    if (readingRows.length > 0) {
      const { error, count } = await admin.from("meter_readings")
        .upsert(readingRows as any, { onConflict: "metering_point_id,reading_at", count: "exact" });
      if (error) throw error;
      readingsInserted = count ?? readingRows.length;
    }

    // 4) Upsert interval reads → consumption_readings
    const intervalRows = intervals.rows
      .filter(r => (r.import_kwh ?? 0) >= 0)
      .map(r => {
        const mp = idMap.get(Number(r.meter_id))!;
        return {
          metering_point_id: mp.id,
          reading_at: new Date(r.bucket).toISOString(),
          actual_mwh: Number(r.import_kwh ?? 0) / 1000,
          source: "PRIVATE_SMART",
          is_estimated: false,
          quality: "measured",
        };
      });
    let intervalsInserted = 0;
    if (intervalRows.length > 0) {
      const chunk = 500;
      for (let i = 0; i < intervalRows.length; i += chunk) {
        const slice = intervalRows.slice(i, i + chunk);
        const { error } = await admin.from("consumption_readings")
          .upsert(slice as any, { onConflict: "metering_point_id,reading_at" });
        if (error) throw error;
        intervalsInserted += slice.length;
      }
    }

    return json({
      ok: true,
      meters: meterIds.length,
      readings_synced: readingsInserted,
      intervals_synced: intervalsInserted,
      window_minutes: windowMinutes,
      bucket_minutes: bucketMinutes,
    });
  } catch (err: any) {
    console.error("sync-kimi-meters error:", err);
    return json({ ok: false, error: err?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}