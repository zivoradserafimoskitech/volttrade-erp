// Indicative EUR reference FX rates. Override per project as needed.
export const FX_TO_EUR: Record<string, number> = {
  EUR: 1,
  MKD: 1 / 61.5,   // 1 MKD ≈ 0.01626 EUR  (≈61.5 MKD per EUR — pegged)
  RSD: 1 / 117.2,  // 1 RSD ≈ 0.00853 EUR  (≈117.2 RSD per EUR)
};

export type Currency = "EUR" | "MKD" | "RSD";
export const SUPPORTED_CURRENCIES: Currency[] = ["EUR", "MKD", "RSD"];

export function convert(amount: number, from: string, to: string): number {
  const f = FX_TO_EUR[from] ?? 1;
  const t = FX_TO_EUR[to] ?? 1;
  return (amount * f) / t;
}

export function currencyForCountry(code?: string | null): Currency {
  if (code === "MK") return "MKD";
  if (code === "RS") return "RSD";
  return "EUR";
}

export function currencySymbol(c: string): string {
  switch (c) {
    case "EUR": return "€";
    case "MKD": return "ден";
    case "RSD": return "дин";
    default: return c;
  }
}

export function formatMoney(amount: number, currency: string, opts: { perUnit?: string; digits?: number } = {}): string {
  const digits = opts.digits ?? (currency === "EUR" ? 2 : 0);
  const sym = currencySymbol(currency);
  const n = amount.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const head = currency === "EUR" ? `${sym}${n}` : `${n} ${sym}`;
  return opts.perUnit ? `${head} / ${opts.perUnit}` : head;
}
