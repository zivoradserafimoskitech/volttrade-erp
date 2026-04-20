export const fmtEur = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(Number(n ?? 0));
export const fmtMwh = (n: number | null | undefined) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(n ?? 0))} MWh`;
export const fmtNum = (n: number | null | undefined, d = 2) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }).format(Number(n ?? 0));