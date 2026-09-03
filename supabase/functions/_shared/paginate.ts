// Paged reads for PostgREST.
//
// THE BUG THIS FIXES (audit 2026-09-01)
// -------------------------------------
// A Supabase project caps every REST response at `max_rows` (1000 by default).
// `.limit(50000)` does NOT lift that cap — it lowers a ceiling that is already
// lower. The request succeeds, returns 1000 rows, and reports no error.
//
// Four callers were relying on `.limit()` as if it were pagination:
//
//   validate-readings   .limit(5000) / .limit(20000) / .limit(50000)
//   forecast-volumes    .limit(100000)
//   Settlement.tsx      .limit(100000)
//   Reconciliation.tsx  no bound at all
//
// One month of hourly data for two metering points is already ~1,460 rows, so
// these were silently truncating in production. README rule 5 states the
// consequence plainly: a silently truncated billing run under-bills every
// customer.
//
// fetchAllRows() walks .range() until a short page arrives, so the caller gets
// the whole result set or an error — never a quiet prefix of it.

const PAGE = 1000;

// The narrow slice of the PostgREST builder we need. Deliberately structural:
// it accepts a query from either the JS client or the Deno one.
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
      throw new Error(
        `fetchAllRows(${opts.label ?? "query"}) failed at offset ${from}: ${
          (error as { message?: string }).message ?? String(error)
        }`,
      );
    }
    const page = data ?? [];
    out.push(...page);

    if (page.length < pageSize) return out;

    // A read that will not terminate is a bug, not something to truncate
    // quietly — which is the failure mode this module exists to remove.
    if (out.length >= maxRows) {
      throw new Error(
        `fetchAllRows(${opts.label ?? "query"}) exceeded maxRows=${maxRows}. ` +
          `Narrow the time window or raise maxRows deliberately.`,
      );
    }
  }
}
