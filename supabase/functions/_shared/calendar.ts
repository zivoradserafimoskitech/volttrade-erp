// Shared season / day-type calendar. Mirrors `seasonOf` and `dayTypeOf` in
// src/lib/slpSynthesis.ts so edge functions and the browser agree on which
// bucket an hour belongs to. Public holidays count as Sunday (SU), the same
// convention used by forecast-volumes.

export type Season = "Spring" | "Summer" | "Autumn" | "Winter";
export type DayType = "WD" | "SA" | "SU";

export function seasonOf(d: Date): Season {
  const m = d.getUTCMonth() + 1;
  if (m >= 3 && m <= 5) return "Spring";
  if (m >= 6 && m <= 8) return "Summer";
  if (m >= 9 && m <= 11) return "Autumn";
  return "Winter";
}

export function dayTypeOf(d: Date, holidays: Set<string>): DayType {
  const iso = d.toISOString().slice(0, 10);
  if (holidays.has(iso)) return "SU";
  const wd = d.getUTCDay();
  if (wd === 0) return "SU";
  if (wd === 6) return "SA";
  return "WD";
}