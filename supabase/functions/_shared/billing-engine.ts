// P0-1 (audit): the billing calculation, extracted from the browser and made
// pure so it can be tested without a database and audited without a browser.
//
// This is a faithful port of src/pages/BillingRuns.tsx `execute()` with the
// money arithmetic replaced (see money.ts) and FOUR CALCULATION BUGS FIXED.
// Every fix is marked `FIX n:` below and is listed in PHASE2.md. Run the
// parity script (scripts/billing-parity.ts) before issuing to see exactly
// which invoices change and by how much.
//
// Purity contract: no I/O, no Date.now(), no randomness. Everything the
// calculation depends on arrives in BillingInput. That is what makes an
// invoice reproducible three years later from its stored snapshot.

import {
  type Money,
  ZERO,
  add,
  convert,
  fromDecimal,
  price,
  sub,
  toDecimal,
  vat,
} from "./money.ts";

// ─── Inputs ─────────────────────────────────────────────────────────────────

export type ReadingSource = "DSO_INTERVAL" | "DSO_MONTHLY" | "PRIVATE_SMART" | string;

export interface IntervalReading {
  metering_point_id: string;
  reading_at: string; // ISO
  actual_mwh: number;
  source: ReadingSource;
  quality?: "measured" | "estimated" | "flagged" | null;
}

export interface RegisterReading {
  metering_point_id: string;
  reading_at: string;
  import_kwh: number;
}

export interface TariffComponent {
  type: "energy" | "fixed_fee" | "margin" | "free_below" | string;
  value: number;
}

export interface Tariff {
  id: string;
  model: "fixed" | "indexed" | string;
  currency: "EUR" | "MKD" | string;
  components: TariffComponent[];
}

export interface SupplyContract {
  id: string;
  client_id: string;
  tariff_id: string;
  contract_number: string;
  payment_terms_days?: number | null;
}

export interface RegulatoryValues {
  ppeePercent: number; // e.g. 12.96
  ppeePriceMkdPerKwh: number; // e.g. 5.5993826
  memoFeeMkdPerMwh: number; // e.g. 14.1
  eurMkd: number; // e.g. 61.695
}

export interface BillingInput {
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  contracts: SupplyContract[];
  tariffs: Tariff[];
  clients: Array<{ id: string; country_code: string | null }>;
  countries: Array<{ code: string; vat_percent: number }>;
  contractPoints: Array<{ contract_id: string; metering_point_id: string }>;
  intervals: IntervalReading[];
  registers: RegisterReading[];
  /** hour key "YYYY-MM-DDTHH" -> EUR/MWh */
  priceMap: Map<string, number>;
  regulatory: RegulatoryValues;
}

// ─── Outputs ────────────────────────────────────────────────────────────────

export interface InvoiceLine {
  type: "energy" | "ppee" | "market_fee" | "free_energy" | "fixed_fee" | "meta";
  label: string;
  mwh?: number;
  unit_price?: number;
  /** minor units */
  amount_minor: number;
  /** minor units */
  vat_minor: number;
  /** decimal, for the NUMERIC columns and for display */
  amount: number;
  vat_amount: number;
}

export interface CalculatedInvoice {
  contract_id: string;
  client_id: string;
  currency: string;
  total_mwh: number;
  free_mwh: number;
  energy_amount: number;
  subtotal: number;
  tax_amount: number;
  total: number;
  lines: InvoiceLine[];
  warnings: string[];
}

export interface BillingResult {
  invoices: CalculatedInvoice[];
  skipped: Array<{ contract_id: string; reason: string }>;
  warnings: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const OFFICIAL_INTERVAL: ReadingSource[] = ["DSO_INTERVAL"];
const OFFICIAL_VOLUME: ReadingSource[] = ["DSO_INTERVAL", "DSO_MONTHLY"];

const hourKey = (iso: string) => new Date(iso).toISOString().slice(0, 13);
const sumMwh = (rows: IntervalReading[]) =>
  rows.reduce((s, r) => s + Number(r.actual_mwh || 0), 0);

// ─── Engine ─────────────────────────────────────────────────────────────────

export function calculateBillingRun(input: BillingInput): BillingResult {
  const result: BillingResult = { invoices: [], skipped: [], warnings: [] };

  // Flagged readings never bill. Unchanged from the original.
  const clean = input.intervals.filter((r) => (r.quality ?? "measured") !== "flagged");

  for (const contract of input.contracts) {
    const tariff = input.tariffs.find((t) => t.id === contract.tariff_id);
    if (!tariff) {
      result.skipped.push({ contract_id: contract.id, reason: "no tariff on contract" });
      continue;
    }

    const warnings: string[] = [];
    const comps = Array.isArray(tariff.components) ? tariff.components : [];
    const comp = (type: string) => comps.find((c) => c.type === type)?.value;
    const energyRate = Number(comp("energy") ?? 0);
    const fixedFee = Number(comp("fixed_fee") ?? 0);
    const margin = Number(comp("margin") ?? 0);
    const freeBelowRaw = comps.find((c) => c.type === "free_below");
    const freeBelow = freeBelowRaw != null ? Number(freeBelowRaw.value) : null;

    const mpIds = input.contractPoints
      .filter((l) => l.contract_id === contract.id)
      .map((l) => l.metering_point_id);

    const mine = clean.filter((r) => mpIds.includes(r.metering_point_id));
    const officialInterval = mine.filter((r) => OFFICIAL_INTERVAL.includes(r.source));
    const officialVolumeRows = mine.filter((r) => OFFICIAL_VOLUME.includes(r.source));
    const internal = mine.filter((r) => !OFFICIAL_VOLUME.includes(r.source));

    const country = input.clients.find((c) => c.id === contract.client_id)?.country_code ?? null;
    const isMK = country === "MK";
    const currency = tariff.currency || "EUR";
    const vatPct = Number(
      input.countries.find((c) => c.code === country)?.vat_percent ?? 0,
    );

    // ── Volume and energy cost ────────────────────────────────────────────
    let totalMwh = 0;
    let freeMwh = 0;
    let energyMoney: Money = ZERO;
    let displayRate = 0;

    if (tariff.model === "indexed") {
      // FIX 1 — dead volume-scaling branch.
      //
      // Original:
      //     shapeRows  = officialForMp.length ? officialForMp : internalForMp
      //     officialVolume = sum(officialForMp)
      //     scale = officialForMp.length === 0 && officialVolume > 0 ? ... : 1
      //
      // `officialVolume` is summed over `officialForMp`, so when
      // `officialForMp.length === 0` it is necessarily 0 and the guard
      // `officialVolume > 0` can never hold. `scale` was ALWAYS 1 — the
      // documented "scale own smart-meter shape to the official volume"
      // behaviour never executed.
      //
      // Worse, `officialForMp` mixed DSO_INTERVAL with DSO_MONTHLY. A single
      // monthly total row would be selected as the SHAPE, so a whole month of
      // consumption was priced at the spot price of the one hour its timestamp
      // happened to land in. On a volatile day that is a very wrong invoice.
      //
      // Corrected: shape and volume are separate concerns.
      //   shape  = DSO_INTERVAL if present, else PRIVATE_SMART
      //   volume = DSO_INTERVAL total, else DSO_MONTHLY total, else shape total
      //   scale  = volume / shapeTotal
      const shapeRows = officialInterval.length > 0 ? officialInterval : internal;
      const shapeTotal = sumMwh(shapeRows);

      let volumeTruth: number;
      if (officialInterval.length > 0) {
        volumeTruth = sumMwh(officialInterval);
      } else if (officialVolumeRows.length > 0) {
        volumeTruth = sumMwh(officialVolumeRows);
        if (shapeTotal > 0) {
          warnings.push(
            `Hourly shape taken from own smart meters and scaled to the official DSO volume ` +
              `(${volumeTruth.toFixed(3)} MWh vs measured ${shapeTotal.toFixed(3)} MWh, ` +
              `factor ${(volumeTruth / shapeTotal).toFixed(4)}).`,
          );
        }
      } else {
        volumeTruth = shapeTotal;
        if (shapeRows.length > 0) {
          warnings.push(
            "No official DSO data for this period — billed on own smart-meter volume.",
          );
        }
      }

      const scale = shapeTotal > 0 ? volumeTruth / shapeTotal : 1;

      // FIX 2 — indexed prices are EUR/MWh but the tariff may be denominated
      // in MKD. The original added EUR-priced energy to MKD-priced PPEE/MEMO
      // lines on the same invoice and labelled the total MKD. Convert here.
      let hoursPriced = 0;
      let hoursMissingPrice = 0;
      let energyDecimal = 0;

      for (const r of shapeRows) {
        const p = input.priceMap.get(hourKey(r.reading_at));
        if (p === undefined) hoursMissingPrice++;
        else hoursPriced++;
        const spot = p ?? 0;
        const v = Number(r.actual_mwh || 0) * scale;
        totalMwh += v;
        if (freeBelow !== null && spot <= freeBelow) {
          freeMwh += v; // free hour — billed at zero
          continue;
        }
        energyDecimal += v * (spot + margin);
      }

      if (hoursMissingPrice > 0) {
        warnings.push(
          `${hoursMissingPrice} of ${hoursMissingPrice + hoursPriced} hours had no market price ` +
            `and were priced at ${margin} (margin only). Load the missing prices and re-run.`,
        );
      }

      const energyEur = fromDecimal(energyDecimal);
      energyMoney = currency === "MKD" ? mkdFromEur(energyEur, input.regulatory.eurMkd) : energyEur;
      displayRate = totalMwh > 0 ? toDecimal(energyMoney) / totalMwh : 0;
    } else {
      // Fixed-price tariff. Volume from intervals, falling back to register
      // deltas. `energyRate` is already in the tariff's own currency.
      const officialForVolume = officialVolumeRows.length > 0 ? officialVolumeRows : internal;
      let mwh = sumMwh(officialForVolume);

      if (mwh <= 0) {
        // FIX 3 — register deltas were `max(readings) - min(readings)` with
        // zero values filtered out. That is wrong across a counter rollover or
        // a meter exchange (the register restarts at 0, so max-min reports the
        // entire pre-reset reading as consumption) and the `> 0` filter also
        // discarded a legitimate zero reading.
        //
        // Corrected: sort by time and sum non-negative consecutive deltas —
        // the same counter-reset-safe rule the gateway platform already
        // applies in api/reports/energy-query.ts. A negative step is treated
        // as a reset and contributes nothing rather than a large negative.
        const { kwh, resets } = registerDeltaKwh(input.registers, mpIds);
        mwh = kwh / 1000;
        if (resets > 0) {
          warnings.push(
            `${resets} meter counter reset(s) detected while deriving volume from register ` +
              `readings; consumption across each reset is not recoverable and was excluded.`,
          );
        }
      }

      totalMwh = mwh;
      energyMoney = price(mwh, energyRate);
      displayRate = energyRate;
    }

    const fixedMoney = fromDecimal(fixedFee);

    if (totalMwh <= 0 && fixedFee <= 0) {
      result.skipped.push({ contract_id: contract.id, reason: "no consumption and no fixed fee" });
      continue;
    }

    // ── Lines ─────────────────────────────────────────────────────────────
    const lines: InvoiceLine[] = [];
    const mkdTo = (mkd: number): Money => {
      const asMkd = fromDecimal(mkd);
      return currency === "MKD" ? asMkd : convert(asMkd, input.regulatory.eurMkd);
    };

    if (isMK) {
      const { ppeePercent, ppeePriceMkdPerKwh, memoFeeMkdPerMwh } = input.regulatory;
      const ppeeMwh = (totalMwh * ppeePercent) / 100;
      const marketMwh = totalMwh - ppeeMwh;

      // The regulated PPEE share is billed at the regulated price, so the
      // market-priced energy is reduced proportionally. Unchanged in intent
      // from the original; expressed in exact money.
      const marketShare = totalMwh > 0 ? marketMwh / totalMwh : 1;
      const energyAmount = mulMoney(energyMoney, marketShare);
      const ppeeAmount = mkdTo(ppeeMwh * 1000 * ppeePriceMkdPerKwh);
      const memoAmount = mkdTo(totalMwh * memoFeeMkdPerMwh);

      lines.push(
        line(
          "energy",
          tariff.model === "indexed"
            ? "Електрична енергија — индексирана цена"
            : "Електрична енергија",
          marketMwh,
          energyAmount,
          vatPct,
          marketMwh > 0 ? toDecimal(energyAmount) / marketMwh : displayRate,
        ),
        line(
          "ppee",
          `Обновлива Енергија (ППЕЕ) — ${ppeePercent}%`,
          ppeeMwh,
          ppeeAmount,
          vatPct,
          ppeeMwh > 0 ? toDecimal(ppeeAmount) / ppeeMwh : 0,
        ),
        line(
          "market_fee",
          "Надомест за користење на пазар на електрична енергија",
          totalMwh,
          memoAmount,
          vatPct,
          totalMwh > 0 ? toDecimal(memoAmount) / totalMwh : 0,
        ),
      );
      if (freeMwh > 0) {
        lines.push(
          line("free_energy", `Бесплатна енергија (пазарна цена ≤ ${freeBelow} /MWh)`, freeMwh, ZERO, vatPct, 0),
        );
      }
      if (fixedFee > 0) {
        lines.push(line("fixed_fee", "Месечен фиксен надоместок", undefined, fixedMoney, vatPct));
      }
      lines.push({
        type: "meta",
        label: `Цените се изразени во ${currency}${
          currency !== "MKD" ? ` (EUR/MKD ${input.regulatory.eurMkd})` : ""
        }`,
        amount_minor: 0,
        vat_minor: 0,
        amount: 0,
        vat_amount: 0,
      });
    } else {
      lines.push(
        line(
          "energy",
          tariff.model === "indexed" ? "Energy — indexed price" : "Energy",
          totalMwh,
          energyMoney,
          vatPct,
          displayRate,
        ),
      );
      if (freeMwh > 0) {
        lines.push(
          line("free_energy", `Free energy (spot ≤ ${freeBelow} /MWh)`, freeMwh, ZERO, vatPct, 0),
        );
      }
      if (fixedFee > 0) {
        lines.push(line("fixed_fee", "Monthly fixed fee", undefined, fixedMoney, vatPct));
      }
    }

    // FIX 4 — VAT consistency.
    //
    // The original emitted a per-line `vat_eur` for every line AND a separate
    // `{type:'vat'}` component computed as vatOf(subtotal), then stored
    // tax_amount_eur = vatOf(subtotal). With independent float rounding at the
    // database boundary the VAT column did not sum to the stated tax total.
    //
    // Corrected: VAT is rounded per line (money.vat) and the invoice tax is
    // the SUM of those. There is no separate VAT component line — the tax
    // total is a document-level field, which is also how a VAT invoice is
    // legally laid out. Guaranteed: sum(line.vat) === tax_amount, and
    // sum(line.amount) + tax_amount === total.
    const subtotalMoney = add(...lines.map((l) => l.amount_minor as Money));
    const taxMoney = add(...lines.map((l) => l.vat_minor as Money));
    const totalMoney = add(subtotalMoney, taxMoney);

    result.invoices.push({
      contract_id: contract.id,
      client_id: contract.client_id,
      currency,
      total_mwh: round3(totalMwh),
      free_mwh: round3(freeMwh),
      energy_amount: toDecimal(energyMoney),
      subtotal: toDecimal(subtotalMoney),
      tax_amount: toDecimal(taxMoney),
      total: toDecimal(totalMoney),
      lines,
      warnings,
    });
  }

  return result;
}

// ─── internals ──────────────────────────────────────────────────────────────

function line(
  type: InvoiceLine["type"],
  label: string,
  mwh: number | undefined,
  amount: Money,
  vatPct: number,
  unitPrice?: number,
): InvoiceLine {
  const v = vat(amount, vatPct);
  return {
    type,
    label,
    ...(mwh !== undefined ? { mwh: round3(mwh) } : {}),
    ...(unitPrice !== undefined ? { unit_price: round4(unitPrice) } : {}),
    amount_minor: amount,
    vat_minor: v,
    amount: toDecimal(amount),
    vat_amount: toDecimal(v),
  };
}

function mulMoney(m: Money, factor: number): Money {
  return fromDecimal(toDecimal(m) * factor);
}

function mkdFromEur(eur: Money, eurMkd: number): Money {
  return fromDecimal(toDecimal(eur) * eurMkd);
}

/**
 * Counter-reset-safe register delta. Readings are sorted by time and only
 * non-negative consecutive steps contribute. Mirrors the rule in the gateway's
 * energy-query.ts so both systems agree on what a meter consumed.
 */
export function registerDeltaKwh(
  registers: RegisterReading[],
  mpIds: string[],
): { kwh: number; resets: number } {
  let kwh = 0;
  let resets = 0;
  for (const id of mpIds) {
    const rs = registers
      .filter((r) => r.metering_point_id === id)
      .map((r) => ({ t: Date.parse(r.reading_at), v: Number(r.import_kwh) }))
      .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
    for (let i = 1; i < rs.length; i++) {
      const delta = rs[i].v - rs[i - 1].v;
      if (delta >= 0) kwh += delta;
      else resets++;
    }
  }
  return { kwh, resets };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
