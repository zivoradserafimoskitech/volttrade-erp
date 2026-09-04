import { authenticate, handler, json as jsonResponse } from "../_shared/auth.ts";
// ZONES / ymdHm / parsePrices now live in _shared/entsoe.ts so the historical
// backfill function reuses the very same A44 parser instead of a second copy.
import { ZONES, ymdHm, parsePrices } from "../_shared/entsoe.ts";


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
