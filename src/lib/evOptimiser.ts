/**
 * Greedy EV charge optimiser.
 *
 * Given a price curve (half-hourly slots) within a charging window and an
 * energy need, pick the cheapest slots until the need is met. Returns an
 * hour-by-hour kW schedule across the next 24 hours.
 */
export type PriceSlot = { ts: string; price_eur_mwh: number };
export type ScheduleSlot = { ts: string; hour: number; minute: number; kw: number; price_eur_mwh: number; charged_kwh: number };

export function optimiseChargePlan(opts: {
  prices: PriceSlot[];           // half-hourly forward curve, sorted by ts
  pluggedInAt: Date;             // start of window
  readyBy: Date;                 // deadline
  batteryKwh: number;
  currentSocPct: number;
  targetSocPct: number;
  maxChargeKw: number;
  slotMinutes?: number;          // default 30
  efficiency?: number;           // default 0.92
}): { schedule: ScheduleSlot[]; estKwh: number; estCostEur: number; avgPriceEurMwh: number } {
  const slotMinutes = opts.slotMinutes ?? 30;
  const slotHours = slotMinutes / 60;
  const efficiency = opts.efficiency ?? 0.92;

  const needKwh = Math.max(0, ((opts.targetSocPct - opts.currentSocPct) / 100) * opts.batteryKwh) / efficiency;
  const slotEnergyKwh = opts.maxChargeKw * slotHours;

  // Filter to slots inside the [pluggedInAt, readyBy] window
  const inWindow = opts.prices.filter(p => {
    const t = new Date(p.ts).getTime();
    return t >= opts.pluggedInAt.getTime() && t < opts.readyBy.getTime();
  });

  // Rank slots cheapest first, pick until need is met
  const ranked = [...inWindow].sort((a, b) => a.price_eur_mwh - b.price_eur_mwh);
  const chosen = new Set<string>();
  let remaining = needKwh;
  for (const s of ranked) {
    if (remaining <= 0) break;
    chosen.add(s.ts);
    remaining -= slotEnergyKwh;
  }

  // Build full schedule, marking chosen slots as charging at max kW
  let totalKwh = 0;
  let totalCost = 0;
  const schedule: ScheduleSlot[] = inWindow.map(s => {
    const isCharging = chosen.has(s.ts);
    const kw = isCharging ? opts.maxChargeKw : 0;
    const charged = isCharging ? slotEnergyKwh : 0;
    totalKwh += charged;
    totalCost += (charged / 1000) * s.price_eur_mwh;
    const d = new Date(s.ts);
    return {
      ts: s.ts,
      hour: d.getHours(),
      minute: d.getMinutes(),
      kw,
      price_eur_mwh: s.price_eur_mwh,
      charged_kwh: charged,
    };
  });

  const avg = totalKwh > 0 ? (totalCost / (totalKwh / 1000)) : 0;
  return { schedule, estKwh: +totalKwh.toFixed(2), estCostEur: +totalCost.toFixed(2), avgPriceEurMwh: +avg.toFixed(2) };
}

/**
 * Synthetic half-hourly price curve for the next 24h from `start`.
 * Used as a fallback when `market_prices` is empty. Lowest overnight (01-05),
 * morning peak (07-09), shoulder midday, sharp evening peak (17-20).
 */
export function syntheticPrices(start: Date, hours = 24): PriceSlot[] {
  const out: PriceSlot[] = [];
  for (let i = 0; i < hours * 2; i++) {
    const t = new Date(start.getTime() + i * 30 * 60_000);
    const h = t.getHours() + t.getMinutes() / 60;
    let p = 80;
    p -= 35 * Math.exp(-Math.pow((h - 3) / 2.5, 2));      // night trough
    p += 60 * Math.exp(-Math.pow((h - 8) / 1.5, 2));      // morning peak
    p += 110 * Math.exp(-Math.pow((h - 19) / 1.8, 2));    // evening peak
    p += (Math.sin(i * 0.7) * 4);                          // jitter
    out.push({ ts: t.toISOString(), price_eur_mwh: Math.max(15, +p.toFixed(2)) });
  }
  return out;
}