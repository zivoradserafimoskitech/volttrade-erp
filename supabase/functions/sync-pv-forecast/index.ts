// PV forecast sync — third-party weather in, our prediction out.
// For every connection point with pv_capacity_kwp > 0 and coordinates:
//  1. Fetch hourly GHI + temperature from Open-Meteo (free, no key) for the
//     next `horizon_hours` (default 48).
//  2. Convert to AC energy:  kWh = kWp × (POA/1000) × PR × tempDerate × calibration
//     POA ≈ GHI × tilt gain (simple transposition), PR = 0.85 system ratio,
//     temp derate −0.4 %/°C of cell temp above 25 °C (cell ≈ ambient + GHI/32).
//     `pv_calibration` is the per-site measured/modelled ratio — the part of
//     the model we learn from our own Kimi measurements.
//  3. Upsert into pv_forecasts (hourly, UTC).
// Invoke: supabase.functions.invoke("sync-pv-forecast", { body: { horizon_hours: 48 } })
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const horizon = Math.min(Number(body.horizon_hours ?? 48), 168);

    const { data: sites } = await admin.from("connection_points")
      .select("id, pv_capacity_kwp, latitude, longitude, pv_tilt_deg, pv_azimuth_deg, pv_calibration")
      .gt("pv_capacity_kwp", 0).eq("status", "active");
    const usable = (sites ?? []).filter((s: any) => s.latitude != null && s.longitude != null);
    if (!usable.length) return json({ ok: true, sites: 0, message: "No active PV connection points with coordinates." });

    // Group sites by rounded coordinates so nearby sites share one weather call
    const cells = new Map<string, any[]>();
    for (const s of usable) {
      const k = `${Number(s.latitude).toFixed(2)}|${Number(s.longitude).toFixed(2)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k)!.push(s);
    }

    let rowsWritten = 0;
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
        const kwp = Number(s.pv_capacity_kwp);
        const tilt = Number(s.pv_tilt_deg ?? 30);
        const cal = Number(s.pv_calibration ?? 1);
        // crude plane-of-array gain for fixed tilt at ~41°N; audit-grade models later
        const tiltGain = 1 + 0.12 * Math.sin((Math.min(Math.max(tilt, 0), 60) / 60) * Math.PI / 2);
        const rows: any[] = [];
        for (let i = 0; i < Math.min(times.length, horizon); i++) {
          const g = Number(ghi[i] ?? 0);
          if (g <= 0) { rows.push({ connection_point_id: s.id, ts: times[i] + ":00Z", forecast_kwh: 0, ghi_wm2: 0, temp_c: temp[i] ?? null }); continue; }
          const cellT = Number(temp[i] ?? 20) + g / 32;
          const tempDerate = 1 - 0.004 * Math.max(cellT - 25, 0);
          const kwh = kwp * (g * tiltGain / 1000) * 0.85 * tempDerate * cal;
          rows.push({ connection_point_id: s.id, ts: times[i].endsWith("Z") ? times[i] : times[i] + ":00Z", forecast_kwh: Math.max(kwh, 0), ghi_wm2: g, temp_c: temp[i] ?? null });
        }
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await admin.from("pv_forecasts").upsert(rows.slice(i, i + 500), { onConflict: "connection_point_id,ts" });
          if (error) throw error;
        }
        rowsWritten += rows.length;
      }
    }
    return json({ ok: true, sites: usable.length, weather_calls: cells.size, rows: rowsWritten, horizon_hours: horizon });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
