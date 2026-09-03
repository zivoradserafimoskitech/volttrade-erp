// Paged reads for the browser Supabase client.
//
// A Supabase project caps every REST response at `max_rows` (1000 by default).
// `.limit(100000)` does not lift that cap. The request succeeds, returns 1000
// rows, reports no error — and the page renders a settlement or reconciliation
// figure computed from an arbitrary prefix of the data.
//
// See README "Rules for any AI agent working in this repo", rule 5.

const PAGE = 1000;

interface RangeableQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

export async function fetchAllRows<T>(
  buildQuery: () => RangeableQuery<T>,
  opts: { pageSize?: number; maxRows?: number; label?: string } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? PAGE;
  const maxRows = opts.maxRows ?? 500_000;
  const out: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) {
      const msg = (error as { message?: string }).message ?? String(error);
      throw new Error(`${opts.label ?? "query"} failed at offset ${from}: ${msg}`);
    }
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) return out;
    if (out.length >= maxRows) {
      throw new Error(
        `${opts.label ?? "query"} exceeded maxRows=${maxRows} — narrow the period.`,
      );
    }
  }
}
