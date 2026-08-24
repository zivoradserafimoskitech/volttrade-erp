// PV forecast sync — Solcast primary, Open-Meteo fallback.
//
// For every active metering point with pv_capacity_kw > 0 and coordinates:
//  1. Solcast (SOLCAST_API_KEY set): rooftop PV power forecast per site
//     (satellite-derived irradiance + Solcast's own PV model, tilt/azimuth
//     aware). PT30M / PT60M pv_estimate (kW) is energy-weighted into hourly kWh
//     and multiplied by the site's pv_calibration.
//  2. Open-Meteo fallback (no key, or Solcast call fails for that site):
//     hourly GHI + temperature converted with a simple transposition model:
//     kWh = kWp × (POA/1000) × 0.85 PR × tempDerate × calibration
//  3. Upsert into pv_forecasts (hourly, UTC) with source = 'solcast' | 'open-meteo'.
//
// Invoke: supabase.functions.invoke("sync-pv-forecast", { body: { horizon_hours: 48 } })
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

const hourKey = (iso: string) => {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
};

/** Solcast rooftop PV power forecast for one site → hourly kWh map (UTC). */
async function solcastHourly(
  key: string,
  s: { latitude: number; longitude: number; pv_capacity_kw: number; pv_tilt_deg: number | null; pv_azimuth_deg: number | null },
  hours: number,
): Promise<{ map: Map<string, number>; status: number }> {
  // Solcast azimuth: 0 = north, 90 = east, 180/-180 = south, -90 = west.
  const compass = Number(s.pv_azimuth_deg ?? 180);
  const az = compass > 180 ? compass - 360 : compass;
  const url = "https://api.solcast.com.au/data/forecast/rooftop_pv_power?" + new URLSearchParams({
    latitude: String(s.latitude),
    longitude: String(s.longitude),
    capacity: String(Number(s.pv_capacity_kw)),
    tilt: String(Number(s.pv_tilt_deg ?? 30)),
    azimuth: String(az),
    hours: String(hours),
    period: "PT60M",
    format: "json",
  });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  const map = new Map<string, number>();
  if (!res.ok) return { map, status: res.status };
  const body = await res.json().catch(() => null);
  const rows: any[] = body?.forecasts ?? [];
  for (const r of rows) {
    const end = r?.period_end;
    if (!end) continue;
    // period_end is the END of the interval; shift back to the interval start.
    const minutes = /PT(\d+)M/.exec(String(r.period ?? "PT60M"))?.[1];
    const span = Number(minutes ?? 60);
    const start = new Date(new Date(end).getTime() - span * 60_000).toISOString();
    const kwh = Number(r.pv_estimate ?? 0) * (span / 60);
    const k = hourKey(start);
    map.set(k, (map.get(k) ?? 0) + kwh);
  }
  return { map, status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const supabaseAdmin_ROLECHECK = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: allowed } = await supabaseAdmin_ROLECHECK.rpc("has_any_role", { _user_id: u.user.id, _roles: ["admin", "operations", "supply_manager"] });
    if (!allowed) return json({ ok: false, error: "Forbidden" }, 403);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const horizon = Math.min(Number(body.horizon_hours ?? 48), 168);
    const solcastKey = Deno.env.get("SOLCAST_API_KEY") ?? "";

    const { data: sites } = await admin.from("metering_points")
      .select("id, pv_capacity_kw, latitude, longitude, pv_tilt_deg, pv_azimuth_deg, pv_calibration")
      .gt("pv_capacity_kw", 0).eq("status", "active").range(0, 999);
    const usable = (sites ?? []).filter((s: any) => s.latitude != null && s.longitude != null);
    if (!usable.length) return json({ ok: true, sites: 0, message: "No active PV metering points with coordinates." });

    const writeRows = async (rows: any[]) => {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("pv_forecasts").upsert(rows.slice(i, i + 500), { onConflict: "metering_point_id,ts" });
        if (error) throw error;
      }
    };

    let rowsWritten = 0;
    let solcastSites = 0;
    let solcastCalls = 0;
    const fallback: any[] = [];

    // ── 1. Solcast per site ────────────────────────────────────────────────
    for (const s of usable) {
      if (!solcastKey) { fallback.push(s); continue; }
      let map = new Map<string, number>();
      let status = 0;
      try {
        const r = await solcastHourly(solcastKey, s as any, horizon);
        map = r.map; status = r.status;
      } catch (_e) { status = 0; }
      solcastCalls++;
      await admin.from("external_api_log").insert({
        provider: "solcast",
        endpoint: "/data/forecast/rooftop_pv_power",
        status: status || 500,
        detail: { metering_point_id: s.id, hours: map.size },
      });
      if (!map.size) { fallback.push(s); continue; }
      const cal = Number(s.pv_calibration ?? 1);
      const rows = [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(0, horizon)
        .map(([ts, kwh]) => ({ metering_point_id: s.id, ts, forecast_kwh: Math.max(kwh * cal, 0), source: "solcast" }));
      await writeRows(rows);
      rowsWritten += rows.length;
      solcastSites++;
    }

    // ── 2. Open-Meteo fallback, grouped by rounded coordinates ─────────────
    const cells = new Map<string, any[]>();
    for (const s of fallback) {
      const k = `${Number(s.latitude).toFixed(2)}|${Number(s.longitude).toFixed(2)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k)!.push(s);
    }

    for (const [key, cellSites] of cells) {
      const [lat, lon] = key.split("|").map(Number);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&hourly=shortwave_radiation,temperature_2m&forecast_days=${Math.ceil(horizon / 24)}&timezone=UTC`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const wx = await res.json();
      const times: string[] = wx?.hourly?.time ?? [];
      const ghi: number[] = wx?.hourly?.shortwave_radiation ?? [];
      const temp: number[] = wx?.hourly?.temperature_2m ?? [];

      for (const s of cellSites) {
        const kwp = Number(s.pv_capacity_kw);
        const tilt = Number(s.pv_tilt_deg ?? 30);
        const cal = Number(s.pv_calibration ?? 1);
        const tiltGain = 1 + 0.12 * Math.sin((Math.min(Math.max(tilt, 0), 60) / 60) * Math.PI / 2);
        const rows: any[] = [];
        for (let i = 0; i < Math.min(times.length, horizon); i++) {
          const ts = times[i].endsWith("Z") ? times[i] : times[i] + ":00Z";
          const g = Number(ghi[i] ?? 0);
          if (g <= 0) { rows.push({ metering_point_id: s.id, ts, forecast_kwh: 0, ghi_wm2: 0, temp_c: temp[i] ?? null, source: "open-meteo" }); continue; }
          const cellT = Number(temp[i] ?? 20) + g / 32;
          const tempDerate = 1 - 0.004 * Math.max(cellT - 25, 0);
          const kwh = kwp * (g * tiltGain / 1000) * 0.85 * tempDerate * cal;
          rows.push({ metering_point_id: s.id, ts, forecast_kwh: Math.max(kwh, 0), ghi_wm2: g, temp_c: temp[i] ?? null, source: "open-meteo" });
        }
        await writeRows(rows);
        rowsWritten += rows.length;
      }
    }

    return json({
      ok: true,
      sites: usable.length,
      provider: solcastKey ? "solcast" : "open-meteo",
      solcast_sites: solcastSites,
      solcast_calls: solcastCalls,
      open_meteo_sites: fallback.length,
      weather_calls: cells.size,
      rows: rowsWritten,
      horizon_hours: horizon,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
});
