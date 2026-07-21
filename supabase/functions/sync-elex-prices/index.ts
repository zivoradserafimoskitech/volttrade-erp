// ELEX (elex.mk) day-ahead price sync — Macedonian power exchange.
// The public API spec at https://elex.mk/api-docs is a JS-rendered Swagger UI,
// so this function has two modes:
//
//  1) DISCOVERY:  { probe: true }
//     Tries the conventional OpenAPI spec locations on elex.mk and returns
//     whatever it finds (paths + a raw sample), WITHOUT writing anything.
//     Run this once from the browser console / Market page to learn the real
//     endpoint + JSON shape, then set the ELEX_* secrets accordingly.
//
//  2) SYNC (default): fetches prices and upserts into market_prices with
//     source='elex'. Endpoint and field mapping are configurable via secrets
//     so no redeploy is needed once discovery tells us the real shape:
//       ELEX_PRICES_URL   e.g. https://elex.mk/api/v1/day-ahead/prices?date={date}
//                         ({date} → YYYY-MM-DD; omit for endpoints without it)
//       ELEX_API_KEY      optional; sent as Authorization: Bearer <key>
//       ELEX_ITEMS_PATH   dot-path to the array in the response (default: auto)
//       ELEX_TIME_FIELD   field with hour timestamp/index (default: auto)
//       ELEX_PRICE_FIELD  field with EUR/MWh price (default: auto)
//
// TEST-PHASE RATE CAP: hard limit 50 outbound ELEX calls per UTC day,
// enforced via external_api_log. Requests over the cap are refused locally.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

const DAILY_CAP = 50;

const dig = (obj: any, path: string) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
const findArray = (obj: any, depth = 0): any[] | null => {
  if (Array.isArray(obj)) return obj;
  if (depth > 3 || obj == null || typeof obj !== "object") return null;
  for (const v of Object.values(obj)) { const a = findArray(v, depth + 1); if (a?.length) return a; }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    // ── rate cap (test phase): 50 outbound calls per UTC day ──
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count } = await admin.from("external_api_log")
      .select("id", { count: "exact", head: true })
      .eq("provider", "elex").gte("called_at", dayStart.toISOString());
    const used = count ?? 0;
    if (used >= DAILY_CAP) {
      return json({ ok: false, error: `ELEX daily test cap reached (${used}/${DAILY_CAP}). Resets 00:00 UTC.` });
    }
    const logCall = (endpoint: string, status: number) =>
      admin.from("external_api_log").insert({ provider: "elex", endpoint, status });

    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = Deno.env.get("ELEX_API_KEY");
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    // ── discovery mode ──
    if (body.probe === true) {
      const candidates = [
        "https://elex.mk/api-docs/swagger.json",
        "https://elex.mk/api-docs.json",
        "https://elex.mk/swagger/v1/swagger.json",
        "https://elex.mk/v3/api-docs",
        "https://elex.mk/api/swagger.json",
        "https://elex.mk/openapi.json",
      ];
      const findings: any[] = [];
      for (const url of candidates) {
        if (used + findings.length >= DAILY_CAP) break;
        try {
          const r = await fetch(url, { headers });
          await logCall(url, r.status);
          if (!r.ok) { findings.push({ url, status: r.status }); continue; }
          const ct = r.headers.get("content-type") ?? "";
          if (!ct.includes("json")) { findings.push({ url, status: r.status, note: `non-JSON (${ct})` }); continue; }
          const spec = await r.json();
          findings.push({ url, status: r.status, title: spec?.info?.title, paths: spec?.paths ? Object.keys(spec.paths) : null });
        } catch (e) { findings.push({ url, error: String(e) }); }
      }
      return json({ ok: true, mode: "probe", findings, calls_used_today: used + findings.length, cap: DAILY_CAP });
    }

    // ── sync mode ──
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const urlTemplate = Deno.env.get("ELEX_PRICES_URL");
    if (!urlTemplate) {
      return json({ ok: false, error: "ELEX_PRICES_URL secret not set. Run { probe: true } first to discover the endpoint, then set the secret." });
    }
    const url = urlTemplate.replace("{date}", date);
    const r = await fetch(url, { headers });
    await logCall(url, r.status);
    if (!r.ok) return json({ ok: false, error: `ELEX responded ${r.status}`, url });
    const payload = await r.json();

    const itemsPath = Deno.env.get("ELEX_ITEMS_PATH");
    const items: any[] | null = itemsPath ? dig(payload, itemsPath) : findArray(payload);
    if (!items?.length) return json({ ok: false, error: "No price array found in response — set ELEX_ITEMS_PATH", sample: JSON.stringify(payload).slice(0, 800) });

    const timeField = Deno.env.get("ELEX_TIME_FIELD");
    const priceField = Deno.env.get("ELEX_PRICE_FIELD");
    const first = items[0];
    const autoTime = timeField ?? Object.keys(first).find(k => /time|hour|date|period|mtu|delivery/i.test(k));
    const autoPrice = priceField ?? Object.keys(first).find(k => /price|eur|mwh|value|amount/i.test(k));
    if (!autoTime || !autoPrice) {
      return json({ ok: false, error: "Could not auto-map fields — set ELEX_TIME_FIELD / ELEX_PRICE_FIELD", sample_keys: Object.keys(first) });
    }

    const rows: any[] = [];
    for (const it of items) {
      const tRaw = it[autoTime];
      const price = Number(it[autoPrice]);
      if (!isFinite(price)) continue;
      let ts: Date | null = null;
      if (typeof tRaw === "number" && tRaw >= 0 && tRaw <= 24) {
        // hour index (1–24 or 0–23) relative to the requested date
        const h = tRaw >= 1 && items.length === 24 && !items.some((x: any) => x[autoTime] === 0) ? tRaw - 1 : tRaw;
        ts = new Date(`${date}T${String(h).padStart(2, "0")}:00:00Z`);
      } else if (typeof tRaw === "string" && !isNaN(Date.parse(tRaw))) {
        ts = new Date(tRaw);
      }
      if (!ts) continue;
      rows.push({ delivery_at: ts.toISOString(), price_eur_mwh: +price.toFixed(2), source: "elex" });
    }
    if (!rows.length) return json({ ok: false, error: "Mapped 0 rows — check field mapping", sample: JSON.stringify(first).slice(0, 400) });

    const { error } = await admin.from("market_prices").upsert(rows, { onConflict: "delivery_at,source" });
    if (error) throw error;
    return json({ ok: true, mode: "sync", date, rows: rows.length, time_field: autoTime, price_field: autoPrice, calls_used_today: used + 1, cap: DAILY_CAP });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
});
