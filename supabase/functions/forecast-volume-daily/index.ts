// forecast-volume-daily — daily volume per PROFILED metering point, measured
// from the customer's own private smart meter, calibrated against the official
// DSO reading. The SHAPE stays the regulatory SLP curve (applied in the
// nomination page) — this function only produces the VOLUME.
//
// Never invents a volume: a metering point with no usable source gets no row.
import { authenticate, handler, json } from "../_shared/auth.ts";
import { dayTypeOf } from "../_shared/calendar.ts";

const PAGE = 1000;
const LOOKBACK_DAYS = 28;
const MIN_HOURS_PER_DAY = 22;
const MIN_DAYS_FULL = 10;
const MIN_DAYS_THIN = 3;
const CAL_MIN = 0.85;
const CAL_MAX = 1.15;
const CAL_MONTHS = 3;

type Reading = {
  metering_point_id: string;
  reading_at: string;
  actual_mwh: number | null;
  quality: string | null;
  source: string | null;
};

async function fetchReadings(
  admin: any,
  ids: string[],
  sinceIso: string,
  sources: string[],
): Promise<Reading[]> {
  const out: Reading[] = [];
  for (let c = 0; c < ids.length; c += 100) {
    const chunk = ids.slice(c, c + 100);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("consumption_readings")
        .select("metering_point_id, reading_at, actual_mwh, quality, source")
        .in("metering_point_id", chunk)
        .in("source", sources)
        .gte("reading_at", sinceIso)
        .order("reading_at")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as Reading[];
      for (const r of rows) if (r.quality !== "flagged") out.push(r);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

Deno.serve(handler(async (req: Request) => {
  const auth = await authenticate(req, { roles: ["admin", "operations", "supply_manager"] });
  const admin = auth.admin;

  let body: { horizon_days?: number } = {};
  try { body = await req.json(); } catch { /* no body */ }
  const horizon = Math.min(Math.max(Number(body.horizon_days ?? 7), 1), 31);

  const { data: mps, error: mpErr } = await admin
    .from("metering_points")
    .select("id, edu_code, kimi_meter_id, metering_category, smart_meter_calibration, calibration_months, annual_consumption_mwh")
    .eq("status", "active")
    .eq("metering_category", "PROFILED");
  if (mpErr) throw mpErr;
  const meters = (mps ?? []) as Array<{
    id: string; edu_code: string; kimi_meter_id: string | null;
    smart_meter_calibration: number | null; calibration_months: number | null;
    annual_consumption_mwh: number | null;
  }>;
  const ids = meters.map((m) => m.id);
  if (!ids.length) return json({ ok: true, meters: 0, forecast_rows: 0, detail: [] });

  const { data: hol } = await admin.from("public_holidays").select("holiday_date");
  const holidays = new Set<string>(((hol ?? []) as Array<{ holiday_date: string }>).map((h) => String(h.holiday_date)));

  // ── Step 1: calibration — official monthly volume / private smart volume ──
  const calSince = new Date(Date.now() - 120 * 86400_000).toISOString();
  const calRows = await fetchReadings(admin, ids, calSince, ["PRIVATE_SMART", "DSO_MONTHLY", "DSO_INTERVAL"]);
  // meter → month → { smart, official }
  const byMeterMonth = new Map<string, Map<string, { smart: number; official: number }>>();
  for (const r of calRows) {
    const month = r.reading_at.slice(0, 7);
    let mm = byMeterMonth.get(r.metering_point_id);
    if (!mm) { mm = new Map(); byMeterMonth.set(r.metering_point_id, mm); }
    let e = mm.get(month);
    if (!e) { e = { smart: 0, official: 0 }; mm.set(month, e); }
    const v = Number(r.actual_mwh ?? 0);
    if (r.source === "PRIVATE_SMART") e.smart += v; else e.official += v;
  }
  const thisMonth = new Date().toISOString().slice(0, 7);
  const calibration = new Map<string, { value: number; months: number; flagged: boolean; raw: number | null }>();
  for (const m of meters) {
    const mm = byMeterMonth.get(m.id);
    const ratios: number[] = [];
    let outOfBand = false, raw: number | null = null;
    if (mm) {
      const months = Array.from(mm.keys()).filter((k) => k < thisMonth).sort().slice(-CAL_MONTHS);
      for (const k of months) {
        const e = mm.get(k)!;
        if (e.smart <= 0 || e.official <= 0) continue;
        const ratio = e.official / e.smart;
        raw = ratio;
        if (ratio < CAL_MIN || ratio > CAL_MAX) { outOfBand = true; continue; }
        ratios.push(ratio);
      }
    }
    const value = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1.0;
    calibration.set(m.id, { value: +value.toFixed(6), months: ratios.length, flagged: outOfBand, raw });
    const prev = Number(m.smart_meter_calibration ?? 1);
    if (Math.abs(prev - value) > 1e-6 || Number(m.calibration_months ?? 0) !== ratios.length) {
      await admin.from("metering_points").update({
        smart_meter_calibration: value,
        calibration_months: ratios.length,
        calibration_updated_at: new Date().toISOString(),
      }).eq("id", m.id);
    }
  }

  // ── Step 2: daily volume from the private smart meter, last 28 days ──
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const smartIds = meters.filter((m) => m.kimi_meter_id).map((m) => m.id);
  const smartRows = smartIds.length ? await fetchReadings(admin, smartIds, since, ["PRIVATE_SMART"]) : [];
  // meter → day → { kwhSum, hours }
  const perMeterDay = new Map<string, Map<string, { mwh: number; hours: number }>>();
  for (const r of smartRows) {
    const day = r.reading_at.slice(0, 10);
    let bd = perMeterDay.get(r.metering_point_id);
    if (!bd) { bd = new Map(); perMeterDay.set(r.metering_point_id, bd); }
    const e = bd.get(day) ?? { mwh: 0, hours: 0 };
    e.mwh += Number(r.actual_mwh ?? 0); e.hours += 1;
    bd.set(day, e);
  }

  // DSO history fallback: average daily volume over the last 90 days
  const dsoSince = new Date(Date.now() - 90 * 86400_000).toISOString();
  const dsoIds = meters.filter((m) => !m.kimi_meter_id).map((m) => m.id);
  const dsoRows = dsoIds.length ? await fetchReadings(admin, dsoIds, dsoSince, ["DSO_MONTHLY", "DSO_INTERVAL"]) : [];
  const dsoTotals = new Map<string, { mwh: number; days: Set<string> }>();
  for (const r of dsoRows) {
    const e = dsoTotals.get(r.metering_point_id) ?? { mwh: 0, days: new Set<string>() };
    e.mwh += Number(r.actual_mwh ?? 0); e.days.add(r.reading_at.slice(0, 10));
    dsoTotals.set(r.metering_point_id, e);
  }

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const horizonDates = Array.from({ length: horizon }, (_, i) => new Date(today.getTime() + (i + 1) * 86400_000));

  const upserts: Array<Record<string, unknown>> = [];
  const detail: Array<Record<string, unknown>> = [];

  for (const m of meters) {
    const cal = calibration.get(m.id)!;
    const byDay = perMeterDay.get(m.id);
    const complete = byDay
      ? Array.from(byDay.entries()).filter(([, e]) => e.hours >= MIN_HOURS_PER_DAY)
      : [];

    let method: string | null = null;
    const byType = new Map<string, { sum: number; n: number }>();
    let flatDaily = 0;

    if (complete.length >= MIN_DAYS_THIN) {
      method = complete.length >= MIN_DAYS_FULL ? "smart_meter" : "smart_meter_thin";
      for (const [day, e] of complete) {
        const dt = dayTypeOf(new Date(`${day}T12:00:00Z`), holidays);
        const b = byType.get(dt) ?? { sum: 0, n: 0 };
        b.sum += e.mwh; b.n += 1; byType.set(dt, b);
      }
      flatDaily = complete.reduce((a, [, e]) => a + e.mwh, 0) / complete.length;
    } else {
      const d = dsoTotals.get(m.id);
      if (d && d.days.size > 0 && d.mwh > 0) {
        method = "dso_history";
        flatDaily = d.mwh / 90;
      } else if (m.annual_consumption_mwh && Number(m.annual_consumption_mwh) > 0) {
        method = "dso_history";
        flatDaily = Number(m.annual_consumption_mwh) / 365;
      }
    }

    if (!method) {
      detail.push({ edu_code: m.edu_code, method: "none", complete_days: complete.length, calibration: cal.value, note: "no source — left blank on purpose" });
      continue;
    }

    const sampleDays = method.startsWith("smart") ? complete.length : 0;
    for (const d of horizonDates) {
      const dt = dayTypeOf(d, holidays);
      const b = byType.get(dt);
      const base = b && b.n > 0 ? b.sum / b.n : flatDaily;
      upserts.push({
        metering_point_id: m.id,
        forecast_date: d.toISOString().slice(0, 10),
        forecast_mwh: +(base * cal.value).toFixed(6),
        method,
        day_type: dt,
        sample_days: sampleDays,
        calibration: cal.value,
      });
    }
    detail.push({
      edu_code: m.edu_code, method, complete_days: complete.length,
      calibration: cal.value, calibration_months: cal.months,
      calibration_flagged: cal.flagged, calibration_raw: cal.raw,
      avg_daily_mwh: +flatDaily.toFixed(4),
    });
  }

  for (let i = 0; i < upserts.length; i += 500) {
    const { error } = await admin.from("volume_forecast_daily")
      .upsert(upserts.slice(i, i + 500), { onConflict: "metering_point_id,forecast_date" });
    if (error) throw error;
  }

  const counts = detail.reduce((acc: Record<string, number>, d) => {
    const k = String(d.method); acc[k] = (acc[k] ?? 0) + 1; return acc;
  }, {});

  await admin.from("external_api_log").insert({
    provider: "internal", endpoint: "forecast-volume-daily", status: 200,
    detail: { meters: meters.length, rows: upserts.length, horizon_days: horizon, methods: counts },
  });

  return json({ ok: true, meters: meters.length, forecast_rows: upserts.length, horizon_days: horizon, methods: counts, detail });
}));