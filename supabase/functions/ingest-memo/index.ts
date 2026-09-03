// supabase/functions/ingest-memo/index.ts
// MEMO day-ahead market price ingestion — native VoltTrade.
// Fetches from MEMO.mk and stores in market_price_history.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, handler, json, resolveOrg } from "../_shared/auth.ts";

// MEMO publishes DAM results after gate closure (10:30 local)
// This function should be scheduled to run daily at ~11:00

// SECURITY REPAIR 2026-09-01 / merged with the 2026-09-03 auth fix
// ----------------------------------------------------------------
// This ran on the service-role key with no caller check and was deployed with
// --no-verify-jwt, so anyone could write market_price_history.
//
// The 3 Sep "Fixed 401 auth errors in jobs" commit moved it onto
// _shared/auth.ts with an inline try/catch — the same direction as this repair,
// so that part is kept and simplified: handler() already converts an AuthError
// into the right status, which is what the inline catch was doing by hand.
//
// What that commit did NOT change is `const orgId = body.org_id`. This function
// runs on the service-role key, so RLS does not apply to it, and a body-supplied
// org id was writing price history into whichever tenant the caller named.
// resolveOrg() now derives the org from the caller's membership and 403s on a
// mismatch; pg_cron (service role) still passes org_id explicitly, which is the
// one case where the body is the only available source.
//
// Roles are the union of both versions: admin/management/trader/risk_officer/
// operations — everyone who legitimately manages price data.
serve(handler(async (req) => {
  const auth = await authenticate(req, {
    roles: ["admin", "management", "trader", "risk_officer", "operations"],
  });
  const supabase = auth.admin;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const date = (body.date as string) || new Date().toISOString().split("T")[0];
  const orgId = await resolveOrg(auth, (body.org_id as string) ?? null);

  // TODO: Replace with actual MEMO API call
  // For now, generate realistic synthetic data based on measured patterns
  const prices: number[] = [];
  const base = [62,58,55,54,56,65,78,95,108,115,118,120,119,115,110,105,102,108,125,145,155,140,110,85];

  for (let h = 0; h < 24; h++) {
    const noise = (Math.random() - 0.5) * 10;
    const spike = Math.random() > 0.9 ? Math.random() * 50 : 0;
    prices.push(Math.round((base[h] + noise + spike) * 100) / 100);
  }

  // Insert into market_price_history
  const records = prices.map((price, hour) => ({
    organization_id: orgId,
    timestamp: `${date}T${hour.toString().padStart(2, "0")}:00:00+00`,
    zone: "MK",
    product: "dam",
    price_eur_mwh: price,
    source: "memo",
    available_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("market_price_history")
    .upsert(records, { onConflict: "organization_id,timestamp,zone,product" });

  if (error) throw error;

  return json({
    success: true,
    date,
    hours_ingested: 24,
    avg_price: Math.round(prices.reduce((a, b) => a + b, 0) / 24 * 100) / 100,
    min_price: Math.min(...prices),
    max_price: Math.max(...prices),
  });
}));
