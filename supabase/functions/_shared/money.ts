// P0-2 (audit): exact money arithmetic.
//
// THE BUG THIS FIXES
// ------------------
// The browser billing run computed every amount as a JS double with NO
// rounding anywhere (`grep toFixed|Math.round` returned nothing). Amounts were
// then inserted into NUMERIC(12,2) columns, so Postgres rounded on write — the
// error was hidden, not removed. Two consequences reached printed invoices:
//
//   1. Line items did not sum to the invoice total. VAT was computed per line
//      AND on the subtotal; in exact arithmetic those agree (VAT is linear),
//      but after independent rounding at the database boundary they do not.
//   2. `components` jsonb stored full-precision floats while the numeric
//      columns stored rounded ones, so the stored breakdown disagreed with the
//      stored total.
//
// THE MODEL
// ---------
// All money is an integer count of MINOR UNITS (cents / дени). EUR and MKD are
// both 2-decimal currencies, so the factor is 100 for everything this system
// bills. Quantities (MWh) and rates (EUR/MWh) stay as floats — they are
// measurements, not money — but every conversion from a measurement to an
// amount funnels through `fromDecimal`, which rounds exactly once.
//
// ROUNDING POLICY (one rule, applied everywhere)
// ----------------------------------------------
// Half-away-from-zero at 2 decimals — the convention used by Macedonian
// accounting practice and by every invoice template this system emits. NOT
// JavaScript's Math.round (which is half-UP, so it rounds -0.5 to -0, giving
// asymmetric behaviour on credit notes) and NOT banker's rounding.
//
// VAT POLICY (one rule, stated once)
// ----------------------------------
// VAT is computed and rounded PER LINE, then summed. The invoice's tax total
// is by construction the sum of its line taxes, and the invoice total is by
// construction sum(lines) + sum(line taxes). This is the only policy under
// which a printed invoice adds up when read column-wise. The alternative
// (round VAT once on the subtotal) makes the VAT column fail to sum.

/** An amount in minor units. Branded so a raw number cannot be passed by accident. */
export type Money = number & { readonly __brand: "Money" };

export const ZERO = 0 as Money;

const MINOR = 100;

/** Half-away-from-zero, unlike Math.round which is half-up. */
function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/**
 * Convert a decimal amount (e.g. 123.456 EUR) into minor units, rounding once.
 * This is the ONLY place a measurement becomes money.
 */
export function fromDecimal(value: number): Money {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot convert non-finite value to Money: ${value}`);
  }
  // Scale first, then round. Multiplying by 100 can itself introduce a
  // representation error (1.005 * 100 === 100.49999999999999), so nudge by a
  // relative epsilon before rounding — this recovers the decimal the user
  // actually typed without affecting genuinely-midway computed values.
  const scaled = value * MINOR;
  const corrected = scaled + Math.sign(scaled) * Math.abs(scaled) * Number.EPSILON * 4;
  const minor = roundHalfAwayFromZero(corrected);
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Money value out of safe range: ${value}`);
  }
  return minor as Money;
}

/** Convert minor units back to a decimal for storage in NUMERIC(12,2). */
export function toDecimal(m: Money): number {
  return m / MINOR;
}

/** Parse an already-exact minor-unit integer. */
export function fromMinor(minor: number): Money {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Money must be a safe integer number of minor units: ${minor}`);
  }
  return minor as Money;
}

export function add(...values: Money[]): Money {
  let acc = 0;
  for (const v of values) acc += v;
  return fromMinor(acc);
}

export function sub(a: Money, b: Money): Money {
  return fromMinor(a - b);
}

export function neg(a: Money): Money {
  return fromMinor(-a);
}

/**
 * Multiply an amount by a dimensionless factor (e.g. a VAT rate, a scaling
 * ratio). Rounds once, using the single policy.
 */
export function mul(a: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Cannot multiply Money by non-finite factor: ${factor}`);
  }
  return fromMinor(roundHalfAwayFromZero(a * factor));
}

/**
 * Price a quantity: quantity (MWh) x unit rate (currency/MWh) -> Money.
 * Kept separate from `fromDecimal` so the intent is legible at call sites and
 * so the multiplication happens in full precision before the single rounding.
 */
export function price(quantity: number, unitRate: number): Money {
  return fromDecimal(quantity * unitRate);
}

/**
 * VAT on a line. Rounded per line — see the VAT policy above.
 * @param rate percentage, e.g. 18 for 18%
 */
export function vat(amount: Money, ratePercent: number): Money {
  return mul(amount, ratePercent / 100);
}

/** Currency conversion. `rate` is units of `from` per one unit of `to`. */
export function convert(amount: Money, ratePerUnit: number): Money {
  if (!Number.isFinite(ratePerUnit) || ratePerUnit <= 0) {
    throw new RangeError(`Invalid conversion rate: ${ratePerUnit}`);
  }
  return fromMinor(roundHalfAwayFromZero(amount / ratePerUnit));
}

export function isZero(m: Money): boolean {
  return m === 0;
}

export function gt(a: Money, b: Money): boolean {
  return a > b;
}

/** Format for display/logging only — never for arithmetic. */
export function format(m: Money, currency = "EUR"): string {
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  return `${sign}${Math.floor(abs / MINOR)}.${String(abs % MINOR).padStart(2, "0")} ${currency}`;
}

/**
 * Distribute an amount across N weighted parts so the parts sum EXACTLY to the
 * original — the largest-remainder method. Not currently used by the invoice
 * path (each line is priced independently) but required by any future
 * proration, credit-note split, or per-metering-point allocation. Included
 * because rolling it ad hoc at the call site is exactly how sum mismatches get
 * reintroduced.
 */
export function allocate(total: Money, weights: number[]): Money[] {
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW <= 0) {
    const out = weights.map(() => ZERO);
    if (out.length > 0) out[0] = total;
    return out;
  }
  const exact = weights.map((w) => (total * w) / sumW);
  const floored = exact.map((e) => Math.floor(e));
  let remainder = total - floored.reduce((s, f) => s + f, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  const out = floored.slice();
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    out[order[k].i]++;
  }
  return out.map((n) => fromMinor(n));
}
