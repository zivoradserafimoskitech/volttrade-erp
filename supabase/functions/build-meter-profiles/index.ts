// build-meter-profiles — derives an hourly load curve per MEASURED (>40 kW)
// metering point from its own measured history. No curve is ever invented:
// a meter without enough complete days simply gets no rows here, and the
// nomination page falls back to SLP (visibly labelled).
//
// Method, per metering point, last 90 days:
//   1. hourly readings from consumption_readings, quality <> 'flagged'
//   2. group by day; drop days with fewer than 20 hours of data
//   3. share[hour] = kWh[hour] / day total
//   4. average the shares per (season, day_type)
//   5. normalise so the 24 hours sum to exactly 1
//   6. store with sample_days = number of days in that bucket
//
// Zero meters with a curve is a valid, expected result at the start.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";
import { authenticate, handler, json } from "../_shared/auth.ts";
import { seasonOf, dayTypeOf } from "../_shared/calendar.ts";

const PAGE = 1000;
const LOOKBACK_DAYS = 90;
const MIN_HOURS_PER_DAY = 20;
const MIN_DAYS = 10; // activation threshold used by the UI ladder

type Bucket = { sums: number[]; days: Set<string> };

Deno.serve(handler(async (req: Request) => {
  const auth = await authenticate(req, { roles: ["admin", "operations", "supply_manager"] });
  const admin = auth.admin;

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);

  // MEASURED metering points
  const { data: mps, error: mpErr } = await admin
    .from("metering_points")
    .select("id, edu_code, client_id")
    .eq("status", "active")
    .eq("metering_category", "MEASURED");
  if (mpErr) throw mpErr;
  const meters = mps ?? [];

  if (!meters.length) {
    await admin.from("external_api_log").insert({
      provider: "internal", endpoint: "build-meter-profiles", status: 200,
      detail: { meters_total: 0, meters_with_profile: 0 },
    });
    return json({ ok: true, meters_total: 0, meters_with_profile: 0, meters_insufficient: 0, detail: [] });
  }

  // Public holidays in range → treated as Sunday
  const { data: hol } = await admin
    .from("public_holidays").select("holiday_date")
    .gte("holiday_date", since.toISOString().slice(0, 10));
  const holidays = new Set<string>((hol ?? []).map((h: { holiday_date: string }) => String(h.holiday_date)));

  // Per meter → per day → hourly kWh (paginated, in id chunks)
  const perMeterDay = new Map<string, Map<string, number[]>>();
  const flagged = new Map<string, number>();
  const ids = meters.map((m: { id: string }) => m.id);

  for (let c = 0; c < ids.length; c += 100) {
    const chunk = ids.slice(c, c + 100);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("consumption_readings")
        .select("metering_point_id, reading_at, actual_mwh, quality")
        .in("metering_point_id", chunk)
        .gte("reading_at", since.toISOString())
        .order("reading_at")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = data ?? [];
      for (const r of rows as Array<{ metering_point_id: string; reading_at: string; actual_mwh: number | null; quality: string }>) {
        if (r.quality === "flagged") {
          flagged.set(r.metering_point_id, (flagged.get(r.metering_point_id) ?? 0) + 1);
          continue;
        }
        const ts = new Date(r.reading_at);
        const day = ts.toISOString().slice(0, 10);
        let byDay = perMeterDay.get(r.metering_point_id);
        if (!byDay) { byDay = new Map(); perMeterDay.set(r.metering_point_id, byDay); }
        let hours = byDay.get(day);
        if (!hours) { hours = Array.from({ length: 24 }, () => Number.NaN); byDay.set(day, hours); }
        const h = ts.getUTCHours();
        hours[h] = (Number.isNaN(hours[h]) ? 0 : hours[h]) + Number(r.actual_mwh ?? 0);
      }
      if (rows.length < PAGE) break;
    }
  }

  const detail: Array<Record<string, unknown>> = [];
  let withProfile = 0, insufficient = 0;

  for (const m of meters as Array<{ id: string; edu_code: string }>) {
    const byDay = perMeterDay.get(m.id) ?? new Map<string, number[]>();
    const buckets = new Map<string, Bucket>();
    let completeDays = 0;

    for (const [day, hours] of byDay) {
      const present = hours.filter((v) => !Number.isNaN(v));
      if (present.length < MIN_HOURS_PER_DAY) continue;
      const total = present.reduce((a, b) => a + b, 0);
      if (total <= 0) continue;
      completeDays++;
      const d = new Date(`${day}T12:00:00Z`);
      const key = `${seasonOf(d)}|${dayTypeOf(d, holidays)}`;
      let b = buckets.get(key);
      if (!b) { b = { sums: Array.from({ length: 24 }, () => 0), days: new Set() }; buckets.set(key, b); }
      for (let h = 0; h < 24; h++) b.sums[h] += (Number.isNaN(hours[h]) ? 0 : hours[h]) / total;
      b.days.add(day);
    }

    if (completeDays < 3) {
      insufficient++;
      detail.push({
        edu_code: m.edu_code, complete_days: completeDays,
        status: completeDays === 0 ? "no_data" : "insufficient", needs: MIN_DAYS,
        flagged: flagged.get(m.id) ?? 0,
      });
      continue;
    }

    const rows: Array<Record<string, unknown>> = [];
    for (const [key, b] of buckets) {
      const [season, dayType] = key.split("|");
      const n = b.days.size;
      const avg = b.sums.map((s) => s / n);
      const sum = avg.reduce((a, x) => a + x, 0);
      if (sum <= 0) continue;
      for (let h = 0; h < 24; h++) {
        rows.push({
          metering_point_id: m.id, season, day_type: dayType, hour: h,
          share: +(avg[h] / sum).toFixed(8), sample_days: n, updated_at: new Date().toISOString(),
        });
      }
    }
    if (!rows.length) {
      insufficient++;
      detail.push({ edu_code: m.edu_code, complete_days: completeDays, status: "insufficient", needs: MIN_DAYS });
      continue;
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("meter_load_profiles")
        .upsert(rows.slice(i, i + 500), { onConflict: "metering_point_id,season,day_type,hour" });
      if (error) throw error;
    }
    withProfile++;
    detail.push({
      edu_code: m.edu_code, complete_days: completeDays,
      status: completeDays >= MIN_DAYS ? "own_profile" : "own_profile_thin",
      combinations: buckets.size, flagged: flagged.get(m.id) ?? 0,
    });
  }

  await admin.from("external_api_log").insert({
    provider: "internal", endpoint: "build-meter-profiles", status: 200,
    detail: { meters_total: meters.length, meters_with_profile: withProfile, meters_insufficient: insufficient },
  });

  return json({
    ok: true,
    meters_total: meters.length,
    meters_with_profile: withProfile,
    meters_insufficient: insufficient,
    detail,
  });
}));