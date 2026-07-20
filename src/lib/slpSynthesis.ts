import coeffData from "./slpCoefficients.json";

export type SlpCategory =
  | "Office" | "Cafe_Restaurant" | "Market_Shop" | "Bakery"
  | "Street_Lighting" | "Base_Station" | "Fuel_Station"
  | "Household" | "Household_Electric_Heating";

export type Season = "Spring" | "Summer" | "Autumn" | "Winter";
export type DayType = "WD" | "SA" | "SU";

type Row = [SlpCategory, Season, DayType, number, number];
const ROWS = coeffData as unknown as Row[];

// Lookup map: cat|season|day|hour -> coeff
// Seeded from the bundled JSON, OVERRIDDEN by the slp_coefficients DB table
// when loadSlpFromDb() succeeds — the database is the single source of truth,
// JSON is only the offline fallback.
const MAP = new Map<string, number>();
for (const [c, s, d, h, v] of ROWS) MAP.set(`${c}|${s}|${d}|${h}`, v);

let dbLoaded = false;
export async function loadSlpFromDb(supabase: any): Promise<boolean> {
  if (dbLoaded) return true;
  try {
    const { data, error } = await supabase.from("slp_coefficients").select("slp_category, season, day_type, hour, coefficient");
    if (error || !data?.length) return false;
    for (const r of data) MAP.set(`${r.slp_category}|${r.season}|${r.day_type}|${r.hour}`, Number(r.coefficient));
    dbLoaded = true;
    return true;
  } catch { return false; }
}

let HOLIDAYS: Set<string> = new Set();
export async function loadHolidays(supabase: any): Promise<Set<string>> {
  try {
    const { data } = await supabase.from("public_holidays").select("holiday_date");
    if (data?.length) HOLIDAYS = new Set(data.map((h: any) => String(h.holiday_date)));
  } catch { /* keep whatever we have */ }
  return HOLIDAYS;
}
export function holidaySet(): Set<string> { return HOLIDAYS; }

export const SLP_CATEGORIES: SlpCategory[] = [
  "Office","Cafe_Restaurant","Market_Shop","Bakery","Street_Lighting",
  "Base_Station","Fuel_Station","Household","Household_Electric_Heating",
];

export function seasonOf(d: Date): Season {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 5) return "Spring";
  if (m >= 6 && m <= 8) return "Summer";
  if (m >= 9 && m <= 11) return "Autumn";
  return "Winter";
}

// Public-holiday calendar can be plugged in here. For now Sat=SA, Sun=SU.
export function dayTypeOf(d: Date, holidays: Set<string> = HOLIDAYS): DayType {
  const iso = d.toISOString().slice(0, 10);
  if (holidays.has(iso)) return "SU";
  const wd = d.getDay();
  if (wd === 0) return "SU";
  if (wd === 6) return "SA";
  return "WD";
}

export function coefficient(cat: SlpCategory, s: Season, d: DayType, hour: number) {
  return MAP.get(`${cat}|${s}|${d}|${hour}`) ?? 0;
}

/** Allocate a monthly kWh total across every hour of [start,end] inclusive. */
export function synthesizeHourly(
  cat: SlpCategory,
  monthlyKwh: number,
  start: Date,
  end: Date,
  holidays: Set<string> = HOLIDAYS
): { ts: Date; kwh: number; coeff: number }[] {
  const out: { ts: Date; kwh: number; coeff: number }[] = [];
  let sumC = 0;
  for (let t = new Date(start); t <= end; t = new Date(t.getTime() + 3600_000)) {
    const c = coefficient(cat, seasonOf(t), dayTypeOf(t, holidays), t.getHours());
    out.push({ ts: new Date(t), kwh: 0, coeff: c });
    sumC += c;
  }
  if (sumC > 0) for (const r of out) r.kwh = (monthlyKwh * r.coeff) / sumC;
  return out;
}

/** Normalized 24h shape for a given season/day type (sums to 1). */
export function shape24h(cat: SlpCategory, s: Season, d: DayType): number[] {
  const raw = Array.from({ length: 24 }, (_, h) => coefficient(cat, s, d, h));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map(v => v / sum);
}