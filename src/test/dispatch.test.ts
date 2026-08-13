// Phase 3 (audit P0-4): dispatch → EMS setpoint conversion.
//
// The sign convention is the thing worth testing hardest. ERP
// asset_dispatch_schedules.setpoint_kw and gateway batteryPowerKw BOTH use
// "+ = discharge to grid, - = charge from grid". Getting that backwards would
// charge the battery at exactly the moment the optimiser meant to discharge —
// i.e. buy at the peak price it was trying to sell into. It would also look
// entirely plausible in a dashboard.
import { describe, it, expect } from "vitest";

interface Dispatch { ts_from: string; ts_to: string; setpoint_kw: number }
interface Setpoint { ts: string; kw: number }

/** Mirrors the conversion in supabase/functions/push-ems-plan/index.ts. */
function buildSetpoints(
  rows: Dispatch[],
  opts: { now: Date; horizonEnd: Date; nameplateKw?: number | null },
): { setpoints: Setpoint[]; clamped: number } {
  const { now, horizonEnd, nameplateKw } = opts;
  const clampKw = (kw: number) =>
    nameplateKw && nameplateKw > 0 ? Math.max(-nameplateKw, Math.min(nameplateKw, kw)) : kw;

  const setpoints: Setpoint[] = [];
  let clamped = 0;
  let lastEnd = new Date(0);

  for (const r of rows) {
    const from = new Date(r.ts_from);
    const to = new Date(r.ts_to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) continue;
    const raw = Number(r.setpoint_kw);
    if (!Number.isFinite(raw)) continue;
    const kw = clampKw(raw);
    if (kw !== raw) clamped++;
    const ts = from < now ? now : from;
    if (ts >= horizonEnd) continue;
    setpoints.push({ ts: ts.toISOString(), kw });
    if (to > lastEnd) lastEnd = to;
  }
  if (setpoints.length === 0) return { setpoints, clamped };

  const planEnd = lastEnd > horizonEnd ? horizonEnd : lastEnd;
  if (planEnd > new Date(setpoints[setpoints.length - 1].ts)) {
    setpoints.push({ ts: planEnd.toISOString(), kw: 0 });
  }
  setpoints.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return { setpoints, clamped };
}

const NOW = new Date("2026-08-12T10:00:00Z");
const HORIZON = new Date("2026-08-13T10:00:00Z");

describe("dispatch → setpoints: sign convention", () => {
  it("a positive ERP setpoint stays positive (discharge)", () => {
    const { setpoints } = buildSetpoints(
      [{ ts_from: "2026-08-12T18:00:00Z", ts_to: "2026-08-12T20:00:00Z", setpoint_kw: 250 }],
      { now: NOW, horizonEnd: HORIZON },
    );
    expect(setpoints[0].kw).toBe(250);
  });

  it("a negative ERP setpoint stays negative (charge)", () => {
    const { setpoints } = buildSetpoints(
      [{ ts_from: "2026-08-12T13:00:00Z", ts_to: "2026-08-12T15:00:00Z", setpoint_kw: -180 }],
      { now: NOW, horizonEnd: HORIZON },
    );
    expect(setpoints[0].kw).toBe(-180);
  });

  it("a full arbitrage cycle keeps charge before discharge", () => {
    // Charge cheap midday, discharge into the evening peak.
    const { setpoints } = buildSetpoints(
      [
        { ts_from: "2026-08-12T12:00:00Z", ts_to: "2026-08-12T14:00:00Z", setpoint_kw: -200 },
        { ts_from: "2026-08-12T19:00:00Z", ts_to: "2026-08-12T21:00:00Z", setpoint_kw: 200 },
      ],
      { now: NOW, horizonEnd: HORIZON },
    );
    expect(setpoints[0].kw).toBeLessThan(0);
    expect(setpoints[1].kw).toBeGreaterThan(0);
    expect(Date.parse(setpoints[0].ts)).toBeLessThan(Date.parse(setpoints[1].ts));
  });
});

describe("dispatch → setpoints: safety", () => {
  it("clamps to nameplate in both directions", () => {
    const { setpoints, clamped } = buildSetpoints(
      [
        { ts_from: "2026-08-12T12:00:00Z", ts_to: "2026-08-12T13:00:00Z", setpoint_kw: 9999 },
        { ts_from: "2026-08-12T14:00:00Z", ts_to: "2026-08-12T15:00:00Z", setpoint_kw: -9999 },
      ],
      { now: NOW, horizonEnd: HORIZON, nameplateKw: 500 },
    );
    expect(setpoints[0].kw).toBe(500);
    expect(setpoints[1].kw).toBe(-500);
    expect(clamped).toBe(2);
  });

  it("never schedules a setpoint in the past", () => {
    const { setpoints } = buildSetpoints(
      [{ ts_from: "2026-08-12T06:00:00Z", ts_to: "2026-08-12T12:00:00Z", setpoint_kw: 100 }],
      { now: NOW, horizonEnd: HORIZON },
    );
    expect(Date.parse(setpoints[0].ts)).toBeGreaterThanOrEqual(NOW.getTime());
  });

  it("appends a trailing zero so the plant does not latch the last setpoint", () => {
    const { setpoints } = buildSetpoints(
      [{ ts_from: "2026-08-12T18:00:00Z", ts_to: "2026-08-12T20:00:00Z", setpoint_kw: 300 }],
      { now: NOW, horizonEnd: HORIZON },
    );
    expect(setpoints.at(-1)!.kw).toBe(0);
    expect(setpoints.at(-1)!.ts).toBe("2026-08-12T20:00:00.000Z");
  });

  it("drops dispatch beyond the horizon", () => {
    const { setpoints } = buildSetpoints(
      [{ ts_from: "2026-08-20T10:00:00Z", ts_to: "2026-08-20T12:00:00Z", setpoint_kw: 100 }],
      { now: NOW, horizonEnd: HORIZON },
    );
    expect(setpoints).toHaveLength(0);
  });

  it("emits setpoints sorted non-descending (gateway requirement)", () => {
    const { setpoints } = buildSetpoints(
      [
        { ts_from: "2026-08-12T20:00:00Z", ts_to: "2026-08-12T21:00:00Z", setpoint_kw: 100 },
        { ts_from: "2026-08-12T12:00:00Z", ts_to: "2026-08-12T13:00:00Z", setpoint_kw: -50 },
      ],
      { now: NOW, horizonEnd: HORIZON },
    );
    for (let i = 1; i < setpoints.length; i++) {
      expect(Date.parse(setpoints[i].ts)).toBeGreaterThanOrEqual(Date.parse(setpoints[i - 1].ts));
    }
  });

  it("ignores malformed rows rather than sending NaN to the plant", () => {
    const { setpoints } = buildSetpoints(
      [
        { ts_from: "not-a-date", ts_to: "2026-08-12T13:00:00Z", setpoint_kw: 100 },
        { ts_from: "2026-08-12T14:00:00Z", ts_to: "2026-08-12T15:00:00Z", setpoint_kw: NaN },
        { ts_from: "2026-08-12T16:00:00Z", ts_to: "2026-08-12T17:00:00Z", setpoint_kw: 75 },
      ],
      { now: NOW, horizonEnd: HORIZON },
    );
    expect(setpoints.filter((s) => !Number.isFinite(s.kw))).toHaveLength(0);
    expect(setpoints[0].kw).toBe(75);
  });

  it("produces nothing when there is no dispatch", () => {
    expect(buildSetpoints([], { now: NOW, horizonEnd: HORIZON }).setpoints).toHaveLength(0);
  });
});
