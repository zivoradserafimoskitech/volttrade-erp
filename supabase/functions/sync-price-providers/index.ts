// Multi-provider day-ahead/spot price sync — same pattern as sync-elex-prices.
// Providers:
//   elecz   (default) — https://elecz.com  FREE, no key, MK zone supported.
//             GET /signal/spot?zone=MK            → current spot
//             GET /signal/cheapest-hours?zone=MK&hours=48 → ranked hourly prices
//             Unit c/kWh → EUR/MWh = value × 10.
//   stekker — https://developer.stekker.com/day-ahead-price-forecast
//             Requires STEKKER_URL + STEKKER_TOKEN (Bearer). Region via
//             body.region or STEKKER_REGION. Generic field auto-mapping.
//   eex     — EEX Group DataSource API. Requires paid subscription:
//             EEX_URL template + EEX_ID + EEX_PASSWORD (Basic auth).
// Writes market_prices with source = provider name (upsert on delivery_at,source).
// TEST-PHASE CAP: 50 outbound calls per provider per UTC day via external_api_log.
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
    const provider = String(body.provider ?? "elecz").toLowerCase();
    if (!["elecz", "stekker", "eex"].includes(provider)) {
      return json({ ok: false, error: "provider must be one of: elecz, stekker, eex" });
    }

    // ── per-provider daily cap ──
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count } = await admin.from("external_api_log")
      .select("id", { count: "exact", head: true })
      .eq("provider", provider).gte("called_at", dayStart.toISOString());
    let used = count ?? 0;
    const guard = () => used < DAILY_CAP;
    const logged = async (url: string, init?: RequestInit) => {
      if (!guard()) throw new Error(`${provider} daily test cap reached (${used}/${DAILY_CAP}). Resets 00:00 UTC.`);
      const r = await fetch(url, init);
      used++;
      await admin.from("external_api_log").insert({ provider, endpoint: url.split("?")[0], status: r.status });
      return r;
    };

    const rows: { delivery_at: string; price_eur_mwh: number; source: string }[] = [];
    let meta: Record<string, unknown> = {};

    if (provider === "elecz") {
      const zone = String(body.zone ?? Deno.env.get("ELECZ_ZONE") ?? "MK");
      // full ranked hourly set for today+tomorrow
      const r = await logged(`https://elecz.com/signal/cheapest-hours?zone=${encodeURIComponent(zone)}&hours=48`, { headers: { Accept: "application/json" } });
      if (!r.ok) return json({ ok: false, error: `elecz responded ${r.status}` });
      const p = await r.json();
      const items: any[] = p?.cheapest_hours ?? p?.ranked_hours ?? findArray(p) ?? [];
      const unit = String(p?.unit ?? items[0]?.unit ?? "c/kWh");
      if (!/c\/?kwh/i.test(unit)) return json({ ok: false, error: `Unexpected unit "${unit}" for zone ${zone} — expected c/kWh (EUR zones only)`, });
      for (const it of items) {
        const tRaw = it.hour ?? it.time ?? it.timestamp;
        const priceCt = Number(it.price);
        if (!tRaw || !isFinite(priceCt) || isNaN(Date.parse(tRaw))) continue;
        rows.push({ delivery_at: new Date(tRaw).toISOString(), price_eur_mwh: +(priceCt * 10).toFixed(2), source: "elecz" });
      }
      meta = { zone, unit, data_complete: p?.data_complete ?? null };
      // current spot as well (fills the current hour even if not among "cheapest")
      if (guard()) {
        const rs = await logged(`https://elecz.com/signal/spot?zone=${encodeURIComponent(zone)}`, { headers: { Accept: "application/json" } });
        if (rs.ok) {
          const sp = await rs.json();
          const v = Number(sp?.price);
          if (isFinite(v) && sp?.timestamp && !sp?.fallback) {
            const ts = new Date(sp.timestamp); ts.setUTCMinutes(0, 0, 0);
            rows.push({ delivery_at: ts.toISOString(), price_eur_mwh: +(v * 10).toFixed(2), source: "elecz" });
          }
        }
      }
    }

    if (provider === "stekker") {
      const url = Deno.env.get("STEKKER_URL");
      const token = Deno.env.get("STEKKER_TOKEN");
      if (!url || !token) return json({ ok: false, error: "STEKKER_URL and STEKKER_TOKEN secrets are required (Bearer auth, price_forecast backend)." });
      const region = String(body.region ?? Deno.env.get("STEKKER_REGION") ?? "");
      const full = region ? `${url}${url.includes("?") ? "&" : "?"}region=${encodeURIComponent(region)}` : url;
      const r = await logged(full, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
      if (!r.ok) return json({ ok: false, error: `stekker responded ${r.status}` });
      const p = await r.json();
      const items = findArray(p) ?? [];
      if (!items.length) return json({ ok: false, error: "No array found in Stekker response", sample: JSON.stringify(p).slice(0, 600) });
      const first = items[0];
      const tf = Object.keys(first).find(k => /time|date|from|start|hour/i.test(k));
      const pf = Object.keys(first).find(k => /price|eur|value|mwh/i.test(k));
      if (!tf || !pf) return json({ ok: false, error: "Could not map Stekker fields", sample_keys: Object.keys(first) });
      for (const it of items) {
        const t = it[tf]; const v = Number(it[pf]);
        if (!t || !isFinite(v) || isNaN(Date.parse(t))) continue;
        rows.push({ delivery_at: new Date(t).toISOString(), price_eur_mwh: +v.toFixed(2), source: "stekker" });
      }
      meta = { region: region || null };
    }

    if (provider === "eex") {
      const urlT = Deno.env.get("EEX_URL");
      const id = Deno.env.get("EEX_ID");
      const pw = Deno.env.get("EEX_PASSWORD");
      if (!urlT || !id || !pw) return json({ ok: false, error: "EEX requires a paid DataSource subscription: set EEX_URL, EEX_ID, EEX_PASSWORD secrets." });
      const date = body.date ?? new Date().toISOString().slice(0, 10);
      const url = urlT.replace("{date}", date);
      const r = await logged(url, { headers: { Accept: "application/json", Authorization: `Basic ${btoa(`${id}:${pw}`)}` } });
      if (!r.ok) return json({ ok: false, error: `eex responded ${r.status}` });
      const p = await r.json();
      const items = findArray(p) ?? [];
      if (!items.length) return json({ ok: false, error: "No array found in EEX response", sample: JSON.stringify(p).slice(0, 600) });
      const first = items[0];
      const tf = Object.keys(first).find(k => /time|date|delivery|period/i.test(k));
      const pf = Object.keys(first).find(k => /price|settlement|value/i.test(k));
      if (!tf || !pf) return json({ ok: false, error: "Could not map EEX fields", sample_keys: Object.keys(first) });
      for (const it of items) {
        const t = it[tf]; const v = Number(it[pf]);
        if (!t || !isFinite(v) || isNaN(Date.parse(t))) continue;
        rows.push({ delivery_at: new Date(t).toISOString(), price_eur_mwh: +v.toFixed(2), source: "eex" });
      }
      meta = { date };
    }

    if (!rows.length) return json({ ok: false, error: "Mapped 0 price rows", meta });
    // dedupe within batch (spot may overlap cheapest-hours)
    const seen = new Map<string, any>();
    rows.forEach(r => seen.set(r.delivery_at, r));
    const unique = [...seen.values()];
    const { error } = await admin.from("market_prices").upsert(unique, { onConflict: "delivery_at,source" });
    if (error) throw error;
    return json({ ok: true, provider, rows: unique.length, ...meta, calls_used_today: used, cap: DAILY_CAP });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
});
