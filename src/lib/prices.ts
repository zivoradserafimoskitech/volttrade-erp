// Source priority for market_prices when several providers cover the same hour.
// Domestic exchange first, then MK via aggregators/ENTSO-E, then regional
// zone tags, then aggregator fallbacks. Legacy untagged "entsoe" is ranked
// LAST so freshly synced zone-tagged rows always override stale legacy data.
const PRIORITY = [
  "elex", "elecz",
  "entsoe-mk", "entsoe-hu", "entsoe-at", "entsoe-ro", "entsoe-rs",
  "entsoe-bg", "entsoe-gr", "entsoe-hr", "entsoe-si", "entsoe-de_lu",
  "stekker", "eex",
  "entsoe",
];

const rank = (src?: string | null) => {
  const s = (src ?? "entsoe").toLowerCase();
  // Exact match wins.
  const exact = PRIORITY.indexOf(s);
  if (exact !== -1) return exact;
  // Otherwise longest "<prefix>-" match wins, so "entsoe-xx" for an unlisted
  // zone still ranks above generic "entsoe" but below listed zones.
  let bestIdx = -1, bestLen = -1;
  for (let i = 0; i < PRIORITY.length; i++) {
    const p = PRIORITY[i];
    if (s.startsWith(p + "-") && p.length > bestLen) { bestIdx = i; bestLen = p.length; }
  }
  return bestIdx === -1 ? PRIORITY.length : bestIdx;
};

/** hourKey (ISO sliced to hour, e.g. "2026-07-20T14") -> EUR/MWh, best source wins */
export function buildPriceMap(rows: { delivery_at: string; price_eur_mwh: number | string; source?: string | null }[]): Map<string, number> {
  const best = new Map<string, { rank: number; price: number }>();
  for (const r of rows ?? []) {
    const key = new Date(r.delivery_at).toISOString().slice(0, 13);
    const rk = rank(r.source);
    const cur = best.get(key);
    if (!cur || rk < cur.rank) best.set(key, { rank: rk, price: Number(r.price_eur_mwh) });
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.price]));
}
