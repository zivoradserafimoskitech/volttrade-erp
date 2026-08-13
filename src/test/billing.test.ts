// P0-2 / item 14 (audit): property tests for the money path.
//
// These are the tests a technical buyer will look for. They assert INVARIANTS
// over thousands of generated cases rather than checking a handful of golden
// numbers, because the failure mode being guarded against (sub-cent drift that
// makes an invoice not add up) does not reproduce on round example figures.
import { describe, it, expect } from "vitest";
import {
  fromDecimal,
  toDecimal,
  fromMinor,
  add,
  sub,
  mul,
  price,
  vat,
  convert,
  allocate,
  format,
  ZERO,
  type Money,
} from "../../supabase/functions/_shared/money";
import {
  calculateBillingRun,
  registerDeltaKwh,
  type BillingInput,
  type IntervalReading,
} from "../../supabase/functions/_shared/billing-engine";

// ─── deterministic PRNG so failures are reproducible ────────────────────────
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const CASES = 2000;

describe("money — rounding policy", () => {
  it("rounds half away from zero, not half up", () => {
    expect(fromDecimal(0.005)).toBe(1);
    expect(fromDecimal(-0.005)).toBe(-1); // Math.round would give -0
    expect(fromDecimal(0.015)).toBe(2);
    expect(fromDecimal(-0.015)).toBe(-2);
  });

  it("recovers decimals that float representation would lose", () => {
    // 1.005 * 100 === 100.49999999999999 in IEEE754
    expect(fromDecimal(1.005)).toBe(101);
    expect(fromDecimal(8.475)).toBe(848);
    expect(fromDecimal(2.675)).toBe(268);
  });

  it("round-trips through toDecimal exactly at 2dp", () => {
    const r = rng(1);
    for (let i = 0; i < CASES; i++) {
      const m = fromMinor(Math.floor(r() * 2_000_000) - 1_000_000);
      expect(fromDecimal(toDecimal(m))).toBe(m);
    }
  });

  it("rejects non-finite and unsafe values", () => {
    expect(() => fromDecimal(NaN)).toThrow();
    expect(() => fromDecimal(Infinity)).toThrow();
    expect(() => fromDecimal(1e18)).toThrow();
    expect(() => mul(fromMinor(100), NaN)).toThrow();
  });
});

describe("money — algebraic properties", () => {
  it("addition is associative and commutative over minor units", () => {
    const r = rng(2);
    for (let i = 0; i < CASES; i++) {
      const a = fromMinor(Math.floor(r() * 100000));
      const b = fromMinor(Math.floor(r() * 100000));
      const c = fromMinor(Math.floor(r() * 100000));
      expect(add(add(a, b), c)).toBe(add(a, add(b, c)));
      expect(add(a, b)).toBe(add(b, a));
    }
  });

  it("a - b + b === a exactly (no drift)", () => {
    const r = rng(3);
    for (let i = 0; i < CASES; i++) {
      const a = fromMinor(Math.floor(r() * 1_000_000));
      const b = fromMinor(Math.floor(r() * 1_000_000));
      expect(add(sub(a, b), b)).toBe(a);
    }
  });

  it("never produces a fractional minor unit", () => {
    const r = rng(4);
    for (let i = 0; i < CASES; i++) {
      const q = r() * 1000;
      const rate = r() * 500;
      const m = price(q, rate);
      expect(Number.isInteger(m)).toBe(true);
      expect(Number.isInteger(vat(m, 18))).toBe(true);
      expect(Number.isInteger(mul(m, r()))).toBe(true);
      expect(Number.isInteger(convert(m, 61.695))).toBe(true);
    }
  });
});

describe("money — allocate", () => {
  it("parts always sum exactly to the total", () => {
    const r = rng(5);
    for (let i = 0; i < CASES; i++) {
      const total = fromMinor(Math.floor(r() * 1_000_000));
      const n = 1 + Math.floor(r() * 8);
      const weights = Array.from({ length: n }, () => r() * 100);
      const parts = allocate(total, weights);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
    }
  });

  it("handles zero weights without losing the money", () => {
    const total = fromMinor(1000);
    const parts = allocate(total, [0, 0, 0]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
  });

  it("splits an indivisible amount without inventing or dropping cents", () => {
    // 10 cents across 3 equal parts must be 4/3/3 (or a permutation), never 3/3/3.
    const parts = allocate(fromMinor(10), [1, 1, 1]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(10);
    expect(parts.sort()).toEqual([3, 3, 4]);
  });
});

describe("money — formatting", () => {
  it("pads minor units", () => {
    expect(format(fromMinor(5), "EUR")).toBe("0.05 EUR");
    expect(format(fromMinor(150), "EUR")).toBe("1.50 EUR");
    expect(format(fromMinor(-150), "MKD")).toBe("-1.50 MKD");
  });
});

// ─── the invariant that was actually broken in production ───────────────────

function buildInput(over: Partial<BillingInput> = {}): BillingInput {
  return {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    contracts: [
      { id: "c1", client_id: "cl1", tariff_id: "t1", contract_number: "K-001", payment_terms_days: 15 },
    ],
    tariffs: [
      {
        id: "t1",
        model: "fixed",
        currency: "EUR",
        components: [
          { type: "energy", value: 85.5 },
          { type: "fixed_fee", value: 12.33 },
        ],
      },
    ],
    clients: [{ id: "cl1", country_code: "MK" }],
    countries: [{ code: "MK", vat_percent: 18 }],
    contractPoints: [{ contract_id: "c1", metering_point_id: "mp1" }],
    intervals: [
      { metering_point_id: "mp1", reading_at: "2026-07-01T00:00:00Z", actual_mwh: 1.234, source: "DSO_INTERVAL" },
      { metering_point_id: "mp1", reading_at: "2026-07-01T01:00:00Z", actual_mwh: 2.345, source: "DSO_INTERVAL" },
    ],
    registers: [],
    priceMap: new Map(),
    regulatory: {
      ppeePercent: 12.96,
      ppeePriceMkdPerKwh: 5.5993826,
      memoFeeMkdPerMwh: 14.1,
      eurMkd: 61.695,
    },
    ...over,
  };
}

describe("billing engine — invoice arithmetic invariants", () => {
  it("line amounts always sum to the subtotal", () => {
    const r = rng(10);
    for (let i = 0; i < 500; i++) {
      const input = buildInput({
        intervals: Array.from({ length: 1 + Math.floor(r() * 24) }, (_, h) => ({
          metering_point_id: "mp1",
          reading_at: `2026-07-01T${String(h).padStart(2, "0")}:00:00Z`,
          actual_mwh: r() * 5,
          source: "DSO_INTERVAL" as const,
        })),
      });
      for (const inv of calculateBillingRun(input).invoices) {
        const sum = inv.lines.reduce((s, l) => s + l.amount_minor, 0);
        expect(sum).toBe(Math.round(inv.subtotal * 100));
      }
    }
  });

  it("line VAT always sums to the invoice tax total", () => {
    const r = rng(11);
    for (let i = 0; i < 500; i++) {
      const vatPct = [0, 5, 18, 20, 21].at(Math.floor(r() * 5))!;
      const input = buildInput({
        countries: [{ code: "MK", vat_percent: vatPct }],
        intervals: Array.from({ length: 1 + Math.floor(r() * 12) }, (_, h) => ({
          metering_point_id: "mp1",
          reading_at: `2026-07-01T${String(h).padStart(2, "0")}:00:00Z`,
          actual_mwh: r() * 9,
          source: "DSO_INTERVAL" as const,
        })),
      });
      for (const inv of calculateBillingRun(input).invoices) {
        const sumVat = inv.lines.reduce((s, l) => s + l.vat_minor, 0);
        expect(sumVat).toBe(Math.round(inv.tax_amount * 100));
      }
    }
  });

  it("subtotal + tax === total, exactly, always", () => {
    const r = rng(12);
    for (let i = 0; i < 1000; i++) {
      const input = buildInput({
        tariffs: [
          {
            id: "t1",
            model: r() > 0.5 ? "indexed" : "fixed",
            currency: r() > 0.5 ? "MKD" : "EUR",
            components: [
              { type: "energy", value: r() * 200 },
              { type: "margin", value: r() * 20 },
              { type: "fixed_fee", value: r() * 50 },
            ],
          },
        ],
        priceMap: new Map(
          Array.from({ length: 24 }, (_, h) => [
            `2026-07-01T${String(h).padStart(2, "0")}`,
            r() * 300 - 20,
          ]),
        ),
        intervals: Array.from({ length: 24 }, (_, h) => ({
          metering_point_id: "mp1",
          reading_at: `2026-07-01T${String(h).padStart(2, "0")}:00:00Z`,
          actual_mwh: r() * 4,
          source: "DSO_INTERVAL" as const,
        })),
      });
      for (const inv of calculateBillingRun(input).invoices) {
        expect(Math.round(inv.total * 100)).toBe(
          Math.round(inv.subtotal * 100) + Math.round(inv.tax_amount * 100),
        );
      }
    }
  });

  it("every stored decimal is exactly representable at 2dp", () => {
    const r = rng(13);
    for (let i = 0; i < 500; i++) {
      // Alternate fixed/indexed and EUR/MKD: an earlier version of this test
      // only exercised the fixed path, so a mutation that removed rounding
      // from the INDEXED energy line went undetected. Mutation testing found
      // that gap; this parameterisation closes it.
      const indexed = i % 2 === 0;
      // Jurisdiction matters here: the MK path re-rounds intermediates
      // (mulMoney on the PPEE market share), which would launder a
      // non-integral amount back into a valid one and hide a rounding
      // regression. The non-MK path adds the energy line straight into the
      // subtotal, so it is the one that actually exposes it.
      const mk = i % 4 < 2;
      const input = buildInput({
        clients: [{ id: "cl1", country_code: mk ? "MK" : "DE" }],
        countries: [
          { code: "MK", vat_percent: 18 },
          { code: "DE", vat_percent: 19 },
        ],
        tariffs: [
          {
            id: "t1",
            model: indexed ? "indexed" : "fixed",
            currency: i % 3 === 0 ? "MKD" : "EUR",
            components: [
              { type: "energy", value: r() * 150 },
              { type: "margin", value: r() * 15 },
              { type: "fixed_fee", value: r() * 40 },
            ],
          },
        ],
        priceMap: new Map(
          Array.from({ length: 6 }, (_, h) => [
            `2026-07-01T0${h}`,
            r() * 250 - 10,
          ]),
        ),
        intervals: Array.from({ length: 6 }, (_, h) => ({
          metering_point_id: "mp1",
          reading_at: `2026-07-01T0${h}:00:00Z`,
          actual_mwh: r() * 7,
          source: "DSO_INTERVAL" as const,
        })),
      });
      for (const inv of calculateBillingRun(input).invoices) {
        for (const v of [inv.subtotal, inv.tax_amount, inv.total]) {
          expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
        }
        for (const l of inv.lines) {
          // Integrality end-to-end: every minor-unit figure the engine emits
          // must be a whole number of cents, on every tariff model.
          expect(Number.isInteger(l.amount_minor)).toBe(true);
          expect(Number.isInteger(l.vat_minor)).toBe(true);
          expect(l.amount_minor).toBe(Math.round(l.amount * 100));
          expect(l.vat_minor).toBe(Math.round(l.vat_amount * 100));
        }
      }
    }
  });

  it("is deterministic — same input, byte-identical output", () => {
    const input = buildInput();
    expect(JSON.stringify(calculateBillingRun(input))).toBe(
      JSON.stringify(calculateBillingRun(buildInput())),
    );
  });

  it("zero VAT produces zero tax and total === subtotal", () => {
    const input = buildInput({ countries: [{ code: "MK", vat_percent: 0 }] });
    for (const inv of calculateBillingRun(input).invoices) {
      expect(inv.tax_amount).toBe(0);
      expect(inv.total).toBe(inv.subtotal);
    }
  });
});

describe("billing engine — the four ported bug fixes", () => {
  it("FIX 1: does not use a monthly total row as the hourly price shape", () => {
    // One DSO_MONTHLY row landing in an expensive hour, plus smart-meter shape
    // spread over cheap hours. The old code priced the whole month at the
    // expensive hour; the new code uses the smart-meter shape scaled to the
    // official monthly volume.
    const priceMap = new Map<string, number>([
      ["2026-07-15T12", 900], // spike hour where the monthly row is timestamped
      ["2026-07-01T00", 50],
      ["2026-07-01T01", 50],
    ]);
    const intervals: IntervalReading[] = [
      { metering_point_id: "mp1", reading_at: "2026-07-15T12:00:00Z", actual_mwh: 100, source: "DSO_MONTHLY" },
      { metering_point_id: "mp1", reading_at: "2026-07-01T00:00:00Z", actual_mwh: 40, source: "PRIVATE_SMART" },
      { metering_point_id: "mp1", reading_at: "2026-07-01T01:00:00Z", actual_mwh: 60, source: "PRIVATE_SMART" },
    ];
    const input = buildInput({
      tariffs: [{ id: "t1", model: "indexed", currency: "EUR", components: [{ type: "margin", value: 0 }] }],
      clients: [{ id: "cl1", country_code: "DE" }],
      countries: [{ code: "DE", vat_percent: 19 }],
      priceMap,
      intervals,
    });
    const [inv] = calculateBillingRun(input).invoices;
    // Volume is the official 100 MWh, priced at the ~50 EUR/MWh shape → ~5000,
    // NOT 100 x 900 = 90 000.
    expect(inv.total_mwh).toBeCloseTo(100, 3);
    expect(inv.subtotal).toBeGreaterThan(4000);
    expect(inv.subtotal).toBeLessThan(6000);
    expect(inv.warnings.join(" ")).toContain("scaled to the official DSO volume");
  });

  it("FIX 2: indexed energy is converted when the tariff is MKD", () => {
    const priceMap = new Map([["2026-07-01T00", 100]]);
    const intervals: IntervalReading[] = [
      { metering_point_id: "mp1", reading_at: "2026-07-01T00:00:00Z", actual_mwh: 10, source: "DSO_INTERVAL" },
    ];
    const eur = calculateBillingRun(
      buildInput({
        tariffs: [{ id: "t1", model: "indexed", currency: "EUR", components: [] }],
        clients: [{ id: "cl1", country_code: "DE" }],
        countries: [{ code: "DE", vat_percent: 0 }],
        priceMap,
        intervals,
      }),
    ).invoices[0];
    const mkd = calculateBillingRun(
      buildInput({
        tariffs: [{ id: "t1", model: "indexed", currency: "MKD", components: [] }],
        clients: [{ id: "cl1", country_code: "DE" }],
        countries: [{ code: "DE", vat_percent: 0 }],
        priceMap,
        intervals,
      }),
    ).invoices[0];
    // 10 MWh x 100 EUR = 1000 EUR = 61 695 MKD
    expect(eur.subtotal).toBeCloseTo(1000, 2);
    expect(mkd.subtotal).toBeCloseTo(61695, 0);
  });

  it("FIX 3: register deltas survive a counter rollover", () => {
    const regs = [
      { metering_point_id: "mp1", reading_at: "2026-07-01T00:00:00Z", import_kwh: 99000 },
      { metering_point_id: "mp1", reading_at: "2026-07-02T00:00:00Z", import_kwh: 99500 },
      { metering_point_id: "mp1", reading_at: "2026-07-03T00:00:00Z", import_kwh: 100 }, // meter replaced
      { metering_point_id: "mp1", reading_at: "2026-07-04T00:00:00Z", import_kwh: 400 },
    ];
    // Old behaviour: max-min = 99500 - 100 = 99 400 kWh billed.
    // New behaviour: 500 + 300 = 800 kWh, reset excluded.
    const { kwh, resets } = registerDeltaKwh(regs, ["mp1"]);
    expect(kwh).toBe(800);
    expect(resets).toBe(1);
  });

  it("FIX 3b: a legitimate zero reading is not discarded", () => {
    const regs = [
      { metering_point_id: "mp1", reading_at: "2026-07-01T00:00:00Z", import_kwh: 0 },
      { metering_point_id: "mp1", reading_at: "2026-07-02T00:00:00Z", import_kwh: 250 },
    ];
    expect(registerDeltaKwh(regs, ["mp1"]).kwh).toBe(250);
  });

  it("FIX 4: there is no separate VAT line double-counting the tax", () => {
    const input = buildInput();
    const [inv] = calculateBillingRun(input).invoices;
    expect(inv.lines.find((l) => (l.type as string) === "vat")).toBeUndefined();
    expect(inv.lines.reduce((s, l) => s + l.vat_minor, 0)).toBe(Math.round(inv.tax_amount * 100));
  });
});

describe("billing engine — operational safety", () => {
  it("warns rather than silently zero-pricing when market prices are missing", () => {
    const input = buildInput({
      tariffs: [{ id: "t1", model: "indexed", currency: "EUR", components: [{ type: "margin", value: 5 }] }],
      priceMap: new Map(), // nothing loaded
    });
    const [inv] = calculateBillingRun(input).invoices;
    expect(inv.warnings.join(" ")).toContain("no market price");
  });

  it("skips a contract with neither consumption nor a fixed fee", () => {
    const input = buildInput({
      tariffs: [{ id: "t1", model: "fixed", currency: "EUR", components: [{ type: "energy", value: 80 }] }],
      intervals: [],
      registers: [],
    });
    const res = calculateBillingRun(input);
    expect(res.invoices).toHaveLength(0);
    expect(res.skipped[0].reason).toContain("no consumption");
  });

  it("still bills a standing charge when consumption is zero", () => {
    const input = buildInput({
      tariffs: [{ id: "t1", model: "fixed", currency: "EUR", components: [{ type: "fixed_fee", value: 10 }] }],
      intervals: [],
    });
    const [inv] = calculateBillingRun(input).invoices;
    expect(inv.subtotal).toBe(10);
    expect(inv.tax_amount).toBe(1.8);
    expect(inv.total).toBe(11.8);
  });

  it("excludes flagged readings from billing", () => {
    const input = buildInput({
      intervals: [
        { metering_point_id: "mp1", reading_at: "2026-07-01T00:00:00Z", actual_mwh: 5, source: "DSO_INTERVAL", quality: "measured" },
        { metering_point_id: "mp1", reading_at: "2026-07-01T01:00:00Z", actual_mwh: 999, source: "DSO_INTERVAL", quality: "flagged" },
      ],
    });
    const [inv] = calculateBillingRun(input).invoices;
    expect(inv.total_mwh).toBeCloseTo(5, 3);
  });

  it("prefers official DSO data over own smart meters for volume", () => {
    const input = buildInput({
      intervals: [
        { metering_point_id: "mp1", reading_at: "2026-07-01T00:00:00Z", actual_mwh: 10, source: "DSO_INTERVAL" },
        { metering_point_id: "mp1", reading_at: "2026-07-01T00:00:00Z", actual_mwh: 99, source: "PRIVATE_SMART" },
      ],
    });
    const [inv] = calculateBillingRun(input).invoices;
    expect(inv.total_mwh).toBeCloseTo(10, 3);
  });
});
