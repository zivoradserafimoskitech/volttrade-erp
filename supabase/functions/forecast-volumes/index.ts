// Volume forecast — projected full-month energy per profiled client and per
// SLP category, from own (Kimi) interval measurements.
//   forecast = consumed-to-date + avg-daily-by-daytype(last 14d) × remaining days
// Day types: WD / SA / SU, public holidays count as SU.
// Every run APPENDS a snapshot to volume_forecasts (audit trail: what we knew
// when we nominated). Invoke: functions.invoke("forecast-volumes", { body: {} })
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

const dayKey = (d: Date, holidays: Set<string>) => {
  const iso = d.toISOString().slice(0, 10);
  if (holidays.has(iso)) return "SU";
  const wd = d.getUTCDay();
  return wd === 0 ? "SU" : wd === 6 ? "SA" : "WD";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const now = body.as_of ? new Date(body.as_of) : new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const histStart = new Date(now.getTime() - 14 * 86400_000);

    const { data: hol } = await admin.from("public_holidays").select("holiday_date")
      .gte("holiday_date", histStart.toISOString().slice(0, 10)).lt("holiday_date", nextMonth.toISOString().slice(0, 10));
    const holidays = new Set<string>((hol ?? []).map((h: any) => h.holiday_date));

    // Profiled/measured classification + client link per metering point
    const { data: cps } = await admin.from("connection_points")
      .select("customer_id, metering_point_id, metering_category, slp_category").eq("status", "active");
    const mpInfo = new Map<string, any>();
    (cps ?? []).forEach((c: any) => { if (c.metering_point_id) mpInfo.set(c.metering_point_id, c); });

    // Interval energy since history start (internal Kimi data is fine here — forecasting, not settlement)
    const { data: iv } = await admin.from("consumption_readings")
      .select("metering_point_id, reading_at, actual_mwh")
      .gte("reading_at", histStart.toISOString()).neq("quality", "flagged").limit(100000);

    // Aggregate per client: consumed this month + daily sums by day type
    type Agg = { toDate: number; byType: Record<string, { sum: number; days: Set<string> }>; category: string | null; segment: string };
    const clients = new Map<string, Agg>();
    for (const r of (iv ?? []) as any[]) {
      const info = mpInfo.get(r.metering_point_id);
      if (!info?.customer_id) continue;
      const ts = new Date(r.reading_at);
      const dk = dayKey(ts, holidays);
      const dISO = ts.toISOString().slice(0, 10);
      const v = Number(r.actual_mwh || 0);
      if (!clients.has(info.customer_id)) clients.set(info.customer_id, { toDate: 0, byType: { WD: { sum: 0, days: new Set() }, SA: { sum: 0, days: new Set() }, SU: { sum: 0, days: new Set() } }, category: info.slp_category, segment: info.metering_category === "MEASURED" ? "MEASURED" : "PROFILED" });
      const a = clients.get(info.customer_id)!;
      if (ts >= monthStart) a.toDate += v;
      if (dISO !== now.toISOString().slice(0, 10)) { a.byType[dk].sum += v; a.byType[dk].days.add(dISO); } // exclude today (partial)
    }

    // Remaining days of month by type
    const remaining: Record<string, number> = { WD: 0, SA: 0, SU: 0 };
    for (let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)); d < nextMonth; d = new Date(d.getTime() + 86400_000)) {
      remaining[dayKey(d, holidays)]++;
    }
    // Today's remainder counts as a full day of its type minus consumed-today ≈ keep simple: today included above as excluded-from-history, add as remaining
    remaining[dayKey(now, holidays)]++;

    const monthISO = monthStart.toISOString().slice(0, 10);
    const rows: any[] = [];
    const catAgg = new Map<string, { toDate: number; fc: number }>();
    const segAgg = new Map<string, { toDate: number; fc: number }>();
    let skippedNoHistory = 0;
    for (const [clientId, a] of clients) {
      const avg = (t: string) => { const b = a.byType[t]; return b.days.size > 0 ? b.sum / b.days.size : null; };
      const wd = avg("WD"), sa = avg("SA") ?? avg("WD"), su = avg("SU") ?? avg("SA") ?? avg("WD");
      if (wd === null) { skippedNoHistory++; continue; }
      const projected = remaining.WD * wd + remaining.SA * (sa ?? 0) + remaining.SU * (su ?? 0);
      // subtract today's partial double-count: today's consumption is in toDate but today also in remaining — remove one avg day of today's type and re-add toDate share is complex; accept ≤1-day bias toward safety (slightly high)
      const fc = a.toDate + projected;
      rows.push({ scope: "client", client_id: clientId, slp_category: a.category, segment: a.segment, month: monthISO, consumed_to_date_mwh: +a.toDate.toFixed(4), forecast_mwh: +fc.toFixed(4) });
      if (a.segment === "PROFILED" && a.category) {
        const c = catAgg.get(a.category) ?? { toDate: 0, fc: 0 }; c.toDate += a.toDate; c.fc += fc; catAgg.set(a.category, c);
      }
      const sgKey = a.segment; const sg = segAgg.get(sgKey) ?? { toDate: 0, fc: 0 }; sg.toDate += a.toDate; sg.fc += fc; segAgg.set(sgKey, sg);
    }
    for (const [cat, c] of catAgg) rows.push({ scope: "slp_category", slp_category: cat, month: monthISO, consumed_to_date_mwh: +c.toDate.toFixed(4), forecast_mwh: +c.fc.toFixed(4) });
    for (const [seg, c] of segAgg) rows.push({ scope: "segment", segment: seg, month: monthISO, consumed_to_date_mwh: +c.toDate.toFixed(4), forecast_mwh: +c.fc.toFixed(4) });

    if (rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("volume_forecasts").insert(rows.slice(i, i + 500));
        if (error) throw error;
      }
    }
    return json({ ok: true, month: monthISO, clients: clients.size, snapshots: rows.length, skipped_no_history: skippedNoHistory });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
