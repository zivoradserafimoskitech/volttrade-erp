import { authenticate, handler, json as jsonResponse } from "../_shared/auth.ts";

// ENTSO-E bidding zone EICs
const ZONES: Record<string, string> = {
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

function ymdHm(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

// Parser for ENTSO-E Publication_MarketDocument (A44 day-ahead prices), REST API v2.
// Handles PT15M/PT30M/PT60M resolutions and curveType A03 (variable-sized blocks:
// a missing position means the previous price stays valid until the next position).
// Sub-hourly points are averaged into hourly delivery slots.
function parsePrices(xml: string): { delivery_at: string; price_eur_mwh: number }[] {
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

// AuthN/AuthZ via _shared/auth.ts: an interactive staff JWT must hold one of the
// listed roles; pg_cron presents the service-role key and is recognised as an
// automated caller (a service-role JWT has no `sub`, so auth.getUser() 401'd).
Deno.serve(handler(async (req) => {
  const auth = await authenticate(req, { roles: ["admin", "operations", "management"] });
  const supabase = auth.admin;

  const token = Deno.env.get("ENTSOE_API_TOKEN");
  if (!token) {
    return jsonResponse(
      { error: "ENTSOE_API_TOKEN not configured. Get a free token from transparency.entsoe.eu and add it as a secret." },
      400,
    );
  }

  {
    let zone = "HU";
    let days = 2; // default: yesterday + today + tomorrow window
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.zone && ZONES[body.zone]) zone = body.zone;
        if (typeof body?.days === "number" && body.days > 0 && body.days <= 7) days = body.days;
      } catch (_) { /* ignore */ }
    } else {
      const url = new URL(req.url);
      const z = url.searchParams.get("zone");
      if (z && ZONES[z]) zone = z;
    }

    const eic = ZONES[zone];
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 3600_000);
    const end = new Date(now.getTime() + days * 24 * 3600_000);

    const params = new URLSearchParams({
      securityToken: token,
      documentType: "A44", // day-ahead prices
      in_Domain: eic,
      out_Domain: eic,
      periodStart: ymdHm(start),
      periodEnd: ymdHm(end),
    });
    const apiUrl = `https://web-api.tp.entsoe.eu/api?${params.toString()}`;

    // Accept header is REQUIRED: without it web-api.tp.entsoe.eu returns its
    // HTML SPA page (HTTP 200/503 with an HTML body) instead of XML.
    const res = await fetch(apiUrl, { headers: { Accept: "application/xml" } });
    const xml = await res.text();
    if (!res.ok) {
      return jsonResponse({ error: `ENTSO-E ${res.status}`, detail: xml.slice(0, 500) }, 502);
    }

    const prices = parsePrices(xml);
    if (prices.length === 0) {
      return jsonResponse({ inserted: 0, zone, note: "No prices in response window" });
    }

    // Zone-tagged source so multiple zones/providers coexist:
    // source = 'entsoe-mk', 'entsoe-hu', ... Upsert per (delivery_at, source) —
    // no more blind window deletes that wiped other providers' rows.
    const startIso = prices[0].delivery_at;
    const endIso = prices[prices.length - 1].delivery_at;
    const tagged = prices.map((r: any) => ({ ...r, source: `entsoe-${zone.toLowerCase()}` }));
    const { error } = await supabase.from("market_prices").upsert(tagged, { onConflict: "delivery_at,source" });
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    // SPEC-accuracy §5: fresh actuals just landed, so mature forecasts may be
    // scoreable now. Fire-and-forget POST to the analytics service's
    // /score-forecasts (same X-API-Key convention as retrain-nightly).
    // Skipped silently when the analytics secrets are unset; a scoring
    // failure must NEVER break the sync response.
    const analyticsUrl = Deno.env.get("VOLTTRADE_ANALYTICS_URL");
    const analyticsKey = Deno.env.get("VOLTTRADE_ANALYTICS_KEY");
    if (analyticsUrl && analyticsKey) {
      fetch(`${analyticsUrl}/score-forecasts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": analyticsKey,
        },
        body: "{}",
      })
        .then(async (r) => {
          if (!r.ok) {
            console.warn(`score-forecasts responded ${r.status}:`, (await r.text()).slice(0, 300));
          }
        })
        .catch((e) => console.warn("score-forecasts trigger failed (ignored):", e));
    }

    return jsonResponse({ inserted: prices.length, zone, caller: auth.kind, from: startIso, to: endIso });
  }
}));
