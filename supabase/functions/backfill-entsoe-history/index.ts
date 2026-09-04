// supabase/functions/backfill-entsoe-history/index.ts
//
// One-off / on-demand historical backfill of ENTSO-E day-ahead prices.
//
// Why this exists separately from sync-entsoe-prices: that function fetches a
// rolling 2–7 day window for operations. Transfer learning (HUPX pretrain →
// MEMO fine-tune) needs YEARS of history, which means dozens of API calls and
// tens of thousands of rows — a different shape of job entirely.
//
// The work is RESUMABLE: each invocation walks forward one month at a time
// until `max_seconds` is spent, then answers { done: false, next_start } so the
// caller can continue where it stopped. That keeps every call well inside the
// edge runtime's wall-clock budget no matter how long the requested range is.
//
// Rows land in public.market_prices with source = 'entsoe-<zone>', so the
// mirror_market_price_history trigger files them under the correct market zone
// in market_price_history (the table the training pipeline reads).

import { authenticate, handler, json as jsonResponse } from "../_shared/auth.ts";
import { ZONES, fetchDayAhead } from "../_shared/entsoe.ts";

interface BackfillRequest {
  zone?: string;
  /** ISO date (YYYY-MM-DD) — inclusive lower bound. */
  start?: string;
  /** ISO date (YYYY-MM-DD) — exclusive upper bound. Defaults to today. */
  end?: string;
  /** Soft time budget for this invocation. */
  max_seconds?: number;
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

Deno.serve(handler(async (req) => {
  const auth = await authenticate(req, { roles: ["admin", "operations", "management"] });
  const supabase = auth.admin;

  const token = Deno.env.get("ENTSOE_API_TOKEN");
  if (!token) {
    return jsonResponse({ error: "ENTSOE_API_TOKEN is not configured." }, 400);
  }

  const body: BackfillRequest = req.method === "POST"
    ? await req.json().catch(() => ({}))
    : {};

  const zone = (body.zone ?? "HU").toUpperCase();
  if (!ZONES[zone]) {
    return jsonResponse({ error: `Unknown zone '${zone}'`, known: Object.keys(ZONES) }, 400);
  }

  const end = body.end ? new Date(`${body.end}T00:00:00Z`) : new Date();
  const defaultStart = new Date(Date.UTC(end.getUTCFullYear() - 3, end.getUTCMonth(), 1));
  let cursor = body.start ? new Date(`${body.start}T00:00:00Z`) : defaultStart;

  if (isNaN(cursor.getTime()) || isNaN(end.getTime())) {
    return jsonResponse({ error: "start/end must be YYYY-MM-DD dates" }, 400);
  }
  if (cursor >= end) {
    return jsonResponse({ done: true, zone, inserted: 0, note: "start is not before end" });
  }

  const budgetMs = Math.min(Math.max(body.max_seconds ?? 90, 10), 240) * 1000;
  const startedAt = Date.now();
  const source = `entsoe-${zone.toLowerCase()}`;

  let inserted = 0;
  let windows = 0;
  const failures: string[] = [];

  while (cursor < end) {
    if (Date.now() - startedAt > budgetMs) {
      return jsonResponse({
        done: false,
        zone,
        inserted,
        windows,
        failures,
        next_start: cursor.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        caller: auth.kind,
      });
    }

    const windowEnd = addMonths(cursor, 1) > end ? end : addMonths(cursor, 1);
    try {
      const prices = await fetchDayAhead(token, ZONES[zone], cursor, windowEnd);
      if (prices.length > 0) {
        const tagged = prices.map((r) => ({ ...r, source }));
        // Chunked upsert: a full month is ~744 rows, comfortably one statement,
        // but chunking keeps the payload bounded for 15-minute resolutions.
        for (let i = 0; i < tagged.length; i += 500) {
          const { error } = await supabase
            .from("market_prices")
            .upsert(tagged.slice(i, i + 500), { onConflict: "delivery_at,source" });
          if (error) throw new Error(error.message);
        }
        inserted += prices.length;
      }
    } catch (e) {
      // A single bad month must not abort a three-year backfill.
      failures.push(`${cursor.toISOString().slice(0, 10)}: ${(e as Error).message}`);
    }

    windows++;
    cursor = windowEnd;
  }

  return jsonResponse({
    done: true,
    zone,
    inserted,
    windows,
    failures,
    end: end.toISOString().slice(0, 10),
    caller: auth.kind,
  });
}));
