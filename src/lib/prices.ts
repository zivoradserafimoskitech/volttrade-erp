// Source priority for market_prices when several providers cover the same hour.
// Domestic exchange first, then MK via aggregators/ENTSO-E, then regional proxies.
const PRIORITY = ["elex", "elecz", "entsoe-mk", "entsoe", "entsoe-hu", "stekker", "eex"];

const rank = (src?: string | null) => {
  const s = (src ?? "entsoe").toLowerCase();
  const i = PRIORITY.findIndex(p => s === p || s.startsWith(p));
  return i === -1 ? PRIORITY.length : i;
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
