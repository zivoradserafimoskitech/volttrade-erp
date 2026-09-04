// Shared ENTSO-E Transparency helpers.
//
// Extracted from sync-entsoe-prices so the historical backfill function can
// reuse exactly the same bidding-zone map and A44 parser — two copies of this
// parser would inevitably drift.

/** ENTSO-E bidding zone EICs. */
export const ZONES: Record<string, string> = {
  HU: "10YHU-MAVIR----U",
  MK: "10YMK-MEPSO----8",
  DE_LU: "10Y1001A1001A82H",
  AT: "10YAT-APG------L",
  RO: "10YRO-TEL------P",
  RS: "10YCS-SERBIATSOV",
  BG: "10YCA-BULGARIA-R",
  GR: "10YGR-HTSO-----Y",
  HR: "10YHR-HEP------M",
  SI: "10YSI-ELES-----O",
};

/** ENTSO-E period format: yyyyMMddHHmm (UTC). */
export function ymdHm(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

// Parser for ENTSO-E Publication_MarketDocument (A44 day-ahead prices), REST API v2.
// Handles PT15M/PT30M/PT60M resolutions and curveType A03 (variable-sized blocks:
// a missing position means the previous price stays valid until the next position).
// Sub-hourly points are averaged into hourly delivery slots.
export function parsePrices(xml: string): { delivery_at: string; price_eur_mwh: number }[] {
  const buckets = new Map<string, { sum: number; n: number }>();
  const periodRe = /<Period>([\s\S]*?)<\/Period>/g;
  let m: RegExpExecArray | null;
  while ((m = periodRe.exec(xml))) {
    const body = m[1];
    const start = body.match(/<timeInterval>[\s\S]*?<start>([^<]+)<\/start>/)?.[1];
    const end = body.match(/<timeInterval>[\s\S]*?<end>([^<]+)<\/end>/)?.[1];
    const resolution = body.match(/<resolution>([^<]+)<\/resolution>/)?.[1] ?? "PT60M";
    if (!start) continue;
    const stepMin = resolution.includes("15") ? 15 : resolution.includes("30") ? 30 : 60;
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    const maxPos = endDate
      ? Math.round((endDate.getTime() - startDate.getTime()) / (stepMin * 60_000))
      : 0;

    const points: { pos: number; price: number }[] = [];
    const pointRe = /<Point>\s*<position>(\d+)<\/position>\s*<price\.amount>([-\d.]+)<\/price\.amount>\s*<\/Point>/g;
    let p: RegExpExecArray | null;
    while ((p = pointRe.exec(body))) {
      points.push({ pos: parseInt(p[1], 10), price: parseFloat(p[2]) });
    }
    if (points.length === 0) continue;
    points.sort((a, b) => a.pos - b.pos);
    const last = maxPos > 0 ? maxPos : points[points.length - 1].pos;

    for (let i = 0; i < points.length; i++) {
      const from = points[i].pos;
      const to = (points[i + 1]?.pos ?? last + 1) - 1; // A03 gap fill
      for (let pos = from; pos <= to; pos++) {
        const t = new Date(startDate.getTime() + (pos - 1) * stepMin * 60_000);
        const hour = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours()));
        const key = hour.toISOString();
        const b = buckets.get(key) ?? { sum: 0, n: 0 };
        b.sum += points[i].price;
        b.n += 1;
        buckets.set(key, b);
      }
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([delivery_at, v]) => ({
      delivery_at,
      price_eur_mwh: Math.round((v.sum / v.n) * 100) / 100,
    }));
}

/** Fetch one A44 day-ahead window for a zone. Throws on a non-OK response. */
export async function fetchDayAhead(
  token: string,
  eic: string,
  start: Date,
  end: Date,
): Promise<{ delivery_at: string; price_eur_mwh: number }[]> {
  const params = new URLSearchParams({
    securityToken: token,
    documentType: "A44",
    in_Domain: eic,
    out_Domain: eic,
    periodStart: ymdHm(start),
    periodEnd: ymdHm(end),
  });
  // Accept header is REQUIRED: without it web-api.tp.entsoe.eu returns its
  // HTML SPA page (HTTP 200/503 with an HTML body) instead of XML.
  const res = await fetch(`https://web-api.tp.entsoe.eu/api?${params.toString()}`, {
    headers: { Accept: "application/xml" },
  });
  const xml = await res.text();
  if (!res.ok) {
    // 400 with "No matching data found" is normal for gaps — treat as empty.
    if (res.status === 400 && /No matching data/i.test(xml)) return [];
    throw new Error(`ENTSO-E ${res.status}: ${xml.slice(0, 300)}`);
  }
  return parsePrices(xml);
}
