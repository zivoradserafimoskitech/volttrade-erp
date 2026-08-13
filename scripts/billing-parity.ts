#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * BILLING PARITY REPORT
 *
 * Phase 2 fixed four calculation bugs. Some invoices will therefore differ
 * from what the browser engine would have produced. Do not discover that
 * after issuing — run this first.
 *
 * It replays a period through BOTH the legacy calculation (reproduced here
 * verbatim, floats and all) and the new engine, then reports every contract
 * whose total moves, with the reason.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   deno run --allow-net --allow-env scripts/billing-parity.ts 2026-07-01 2026-07-31
 *
 * Read the output as: anything under a cent is rounding (expected and
 * correct). Anything larger is one of the four fixes firing, and the reason
 * column tells you which.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";
import { calculateBillingRun, type BillingInput } from "../supabase/functions/_shared/billing-engine.ts";

const [periodStart, periodEnd] = Deno.args;
if (!periodStart || !periodEnd) {
  console.error("Usage: billing-parity.ts <period_start> <period_end>  (YYYY-MM-DD)");
  Deno.exit(1);
}

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  Deno.exit(1);
}
const db = createClient(url, key);

const startISO = `${periodStart}T00:00:00Z`;
const endISO = `${periodEnd}T23:59:59Z`;

async function all(table: string, build: (q: any) => any): Promise<any[]> {
  const PAGE = 1000;
  let from = 0;
  const out: any[] = [];
  for (;;) {
    const { data, error } = await build(db.from(table)).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const [contracts, tariffs, clients, countries, links, intervals, registers, prices, regs] =
  await Promise.all([
    all("supply_contracts", (q) => q.select("*").eq("status", "active")),
    all("tariffs", (q) => q.select("*")),
    all("clients", (q) => q.select("id,country_code")),
    all("countries", (q) => q.select("code,vat_percent")),
    all("supply_contract_points", (q) => q.select("*")),
    all("consumption_readings", (q) =>
      q.select("metering_point_id,reading_at,actual_mwh,source,quality")
        .gte("reading_at", startISO).lte("reading_at", endISO)),
    all("meter_readings", (q) =>
      q.select("metering_point_id,reading_at,import_kwh")
        .eq("validation_status", "validated")
        .gte("reading_at", startISO).lte("reading_at", endISO)),
    all("market_prices", (q) =>
      q.select("delivery_at,price_eur_mwh,source")
        .gte("delivery_at", startISO).lte("delivery_at", endISO)),
    all("regulatory_charges", (q) =>
      q.select("*").lte("valid_from", periodEnd)
        .or(`valid_to.is.null,valid_to.gte.${periodStart}`)),
  ]);

// ─── PAGINATION CHECK ───────────────────────────────────────────────────────
// The browser engine used a plain .select() with no .range(), so PostgREST
// capped it at 1000 rows and the run silently billed truncated data.
const TRUNCATION_LIMIT = 1000;
const truncated: string[] = [];
if (intervals.length > TRUNCATION_LIMIT) truncated.push(`consumption_readings (${intervals.length})`);
if (registers.length > TRUNCATION_LIMIT) truncated.push(`meter_readings (${registers.length})`);
if (prices.length > TRUNCATION_LIMIT) truncated.push(`market_prices (${prices.length})`);

const priceMap = new Map<string, number>();
for (const p of prices) {
  priceMap.set(new Date(p.delivery_at).toISOString().slice(0, 13), Number(p.price_eur_mwh));
}
const regValue = (code: string, fallback: number, anchor: string) => {
  const rows = regs
    .filter((r: any) => r.code === code && r.valid_from <= anchor)
    .sort((a: any, b: any) => (a.valid_from < b.valid_from ? 1 : -1));
  return rows.length ? Number(rows[0].value) : fallback;
};

const input: BillingInput = {
  periodStart, periodEnd, contracts, tariffs, clients, countries,
  contractPoints: links, intervals, registers, priceMap,
  regulatory: {
    ppeePercent: regValue("PPEE_PERCENT", 12.96, periodStart),
    ppeePriceMkdPerKwh: regValue("PPEE_PRICE", 5.5993826, periodStart),
    memoFeeMkdPerMwh: regValue("MEMO_FEE", 14.1, periodStart),
    eurMkd: regValue("EUR_MKD", 61.695, periodStart),
  },
};

// ─── LEGACY ENGINE — verbatim reproduction of BillingRuns.tsx execute() ─────
function legacy(): Map<string, { total: number; mwh: number }> {
  const out = new Map<string, { total: number; mwh: number }>();
  const clean = intervals.filter((r: any) => (r.quality ?? "measured") !== "flagged");
  const officialIv = clean.filter((r: any) => r.source === "DSO_INTERVAL" || r.source === "DSO_MONTHLY");
  const internalIv = clean.filter((r: any) => r.source !== "DSO_INTERVAL" && r.source !== "DSO_MONTHLY");
  const ivs = officialIv.length > 0 ? officialIv : internalIv;
  // Legacy anchored regulatory lookup on period_end.
  const ppeePct = regValue("PPEE_PERCENT", 12.96, periodEnd);
  const ppeePriceMkdKwh = regValue("PPEE_PRICE", 5.5993826, periodEnd);
  const memoFeeMkdMwh = regValue("MEMO_FEE", 14.1, periodEnd);
  const eurMkd = regValue("EUR_MKD", 61.695, periodEnd);

  for (const c of contracts) {
    const t = tariffs.find((x: any) => x.id === c.tariff_id);
    if (!t) continue;
    const comps = (Array.isArray(t.components) ? t.components : []) as any[];
    const energyPrice = comps.find((x: any) => x.type === "energy")?.value ?? 0;
    const fixed = comps.find((x: any) => x.type === "fixed_fee")?.value ?? 0;
    const marginComp = comps.find((x: any) => x.type === "margin")?.value ?? 0;
    const freeBelowComp = comps.find((x: any) => x.type === "free_below");
    const freeBelow: number | null = freeBelowComp != null ? Number(freeBelowComp.value) : null;
    const mpIds = links.filter((l: any) => l.contract_id === c.id).map((l: any) => l.metering_point_id);

    let mwh: number, marketEnergyEur: number, freeMwh = 0;
    if ((t as any).model === "indexed") {
      const officialForMp = officialIv.filter((x: any) => mpIds.includes(x.metering_point_id));
      const internalForMp = internalIv.filter((x: any) => mpIds.includes(x.metering_point_id));
      const shapeRows = officialForMp.length > 0 ? officialForMp : internalForMp;
      const officialVolume = officialForMp.reduce((s: number, r: any) => s + Number(r.actual_mwh || 0), 0);
      const shapeVolume = shapeRows.reduce((s: number, r: any) => s + Number(r.actual_mwh || 0), 0);
      const scale = officialForMp.length === 0 && officialVolume > 0 && shapeVolume > 0 ? officialVolume / shapeVolume : 1;
      let eur = 0; mwh = 0;
      for (const r of shapeRows) {
        const key = new Date(r.reading_at).toISOString().slice(0, 13);
        const p = priceMap.get(key) ?? 0;
        const v = Number(r.actual_mwh || 0) * scale;
        mwh += v;
        if (freeBelow !== null && p <= freeBelow) { freeMwh += v; continue; }
        eur += v * (p + Number(marginComp));
      }
      marketEnergyEur = eur;
    } else {
      const iv = ivs.filter((r: any) => mpIds.includes(r.metering_point_id))
        .reduce((s: number, r: any) => s + Number(r.actual_mwh || 0), 0);
      let reg = 0;
      for (const id of mpIds) {
        const rs = registers.filter((r: any) => r.metering_point_id === id)
          .map((r: any) => Number(r.import_kwh || 0)).filter((v: number) => v > 0);
        if (rs.length >= 2) reg += Math.max(...rs) - Math.min(...rs);
      }
      mwh = iv > 0 ? iv : reg / 1000;
      marketEnergyEur = mwh * Number(energyPrice);
    }
    if (mwh <= 0 && Number(fixed) <= 0) continue;

    const country = clients.find((x: any) => x.id === c.client_id)?.country_code;
    const isMK = country === "MK";
    const cur = ((t as any).currency || "EUR") as string;
    const vatPct = countries.find((x: any) => x.code === country)?.vat_percent ?? 0;
    const vatOf = (v: number) => (v * Number(vatPct)) / 100;

    let subtotal: number;
    if (isMK) {
      const mkdTo = (mkd: number) => (cur === "MKD" ? mkd : mkd / eurMkd);
      const ppeeMwh = (mwh * ppeePct) / 100;
      const marketMwh = mwh - ppeeMwh;
      const energy_amount = marketEnergyEur * (marketMwh / (mwh || 1));
      subtotal = energy_amount + mkdTo(ppeeMwh * 1000 * ppeePriceMkdKwh) + mkdTo(mwh * memoFeeMkdMwh) + Number(fixed);
    } else {
      subtotal = marketEnergyEur + Number(fixed);
    }
    out.set(c.id, { total: subtotal + vatOf(subtotal), mwh });
  }
  return out;
}

// ─── Compare ────────────────────────────────────────────────────────────────
const before = legacy();
const after = calculateBillingRun(input);
const afterMap = new Map(after.invoices.map((i) => [i.contract_id, i]));

console.log(`\nBILLING PARITY — ${periodStart} .. ${periodEnd}`);
console.log("=".repeat(78));

if (truncated.length > 0) {
  console.log(`
!! ROW-LIMIT TRUNCATION DETECTED
   ${truncated.join(", ")} exceed PostgREST's 1000-row default.
   The browser engine did not paginate, so any past run over this period
   billed only the FIRST 1000 rows of each table and under-billed everyone.
   The new engine paginates. Expect large positive deltas below.
`);
}

const rows: Array<{ id: string; before: number; after: number; delta: number; why: string }> = [];
for (const [cid, b] of before) {
  const a = afterMap.get(cid);
  const aTotal = a?.total ?? 0;
  const delta = aTotal - b.total;
  if (Math.abs(delta) < 0.005) continue;
  const why = a?.warnings.length ? a.warnings[0].slice(0, 60) : (truncated.length ? "row-limit truncation" : "calculation fix");
  rows.push({ id: cid, before: b.total, after: aTotal, delta, why });
}
for (const [cid, a] of afterMap) {
  if (!before.has(cid)) rows.push({ id: cid, before: 0, after: a.total, delta: a.total, why: "newly billed" });
}

rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

console.log(`Contracts compared : ${before.size}`);
console.log(`Invoices (new)     : ${after.invoices.length}`);
console.log(`Materially changed : ${rows.length}`);
console.log(`Net delta          : ${rows.reduce((s, r) => s + r.delta, 0).toFixed(2)}\n`);

if (rows.length === 0) {
  console.log("No material differences. Safe to proceed.");
} else {
  console.log("contract_id                            before      after      delta  reason");
  console.log("-".repeat(78));
  for (const r of rows.slice(0, 60)) {
    console.log(
      `${r.id.padEnd(38)}${r.before.toFixed(2).padStart(10)}${r.after.toFixed(2).padStart(11)}` +
      `${r.delta.toFixed(2).padStart(11)}  ${r.why}`,
    );
  }
  if (rows.length > 60) console.log(`... and ${rows.length - 60} more`);
  console.log(`
Review each of these before issuing. A delta here means the OLD invoice was
wrong, not the new one — but you should understand why for every line.`);
}

const warned = after.invoices.filter((i) => i.warnings.length > 0);
if (warned.length > 0) {
  console.log(`\nWARNINGS (${warned.length} contract(s)):`);
  for (const w of warned.slice(0, 20)) {
    console.log(`  ${w.contract_id}: ${w.warnings.join(" | ")}`);
  }
}
