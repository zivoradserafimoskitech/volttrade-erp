// Standard Load Profile (SLP) helpers
// Allocates an annual or period consumption to hourly volumes using the
// stored slp_curve_points (season × day_type × hour factors).

import { supabase } from "@/integrations/supabase/client";

export type Season = "spring" | "summer" | "autumn" | "winter";
export type DayType = "WD" | "SA" | "SU";

export function seasonOf(date: Date): Season {
  const m = date.getMonth() + 1; // 1..12
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

export function dayTypeOf(date: Date): DayType {
  const d = date.getDay(); // 0=Sun..6=Sat
  if (d === 0) return "SU";
  if (d === 6) return "SA";
  return "WD";
}

export type CurveLookup = Map<string, number>; // key: `${season}|${dayType}|${hour}` -> factor

export async function loadCurve(profileCode: string): Promise<CurveLookup> {
  const { data, error } = await supabase
    .from("slp_curve_points")
    .select("season,day_type,hour,factor")
    .eq("profile_code", profileCode);
  if (error) throw error;
  const m: CurveLookup = new Map();
  (data ?? []).forEach((p: any) => m.set(`${p.season}|${p.day_type}|${p.hour}`, Number(p.factor)));
  return m;
}

/**
 * Allocate a total energy volume (MWh) over the requested hourly timestamps
 * using the given profile's hourly factors. Returns MWh per hour.
 */
export function allocateBySlp(totalMwh: number, hours: Date[], curve: CurveLookup): number[] {
  const weights = hours.map(h => curve.get(`${seasonOf(h)}|${dayTypeOf(h)}|${h.getHours()}`) ?? 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return hours.map(() => 0);
  return weights.map(w => (w / sum) * totalMwh);
}

export function hourlyRange(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const t = new Date(start); t.setMinutes(0, 0, 0);
  while (t < end) { out.push(new Date(t)); t.setHours(t.getHours() + 1); }
  return out;
}