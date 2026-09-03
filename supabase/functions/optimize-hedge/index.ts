// supabase/functions/optimize-hedge/index.ts
// Stochastic LP + CVaR hedge optimization — native VoltTrade.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, handler, json, resolveOrg } from "../_shared/auth.ts";

const ANALYTICS_URL = Deno.env.get("VOLTTRADE_ANALYTICS_URL") || "http://localhost:8000";
const ANALYTICS_KEY = Deno.env.get("VOLTTRADE_ANALYTICS_KEY") || "";

interface HedgeOptRequest {
  org_id?: string;
  target_hedge_ratio?: number;
  risk_aversion?: number;
  scenarios?: number;
  capital_at_risk_eur?: number;
}

// SECURITY REPAIR 2026-09-01
// --------------------------
// This function had no authentication of any kind and took `org_id` straight
// from the request body, while deploy-risk-module.yml shipped it with
// --no-verify-jwt. Anyone could run a hedge optimisation against — and read the
// resulting position of — another tenant's book.
//
// org_id is now a filter, never an identity: resolveOrg() derives it from the
// caller's membership row and 403s when the body disagrees.
serve(handler(async (req) => {
  const auth = await authenticate(req, {
    roles: ["admin", "management", "trader", "risk_officer"],
  });

  const body: HedgeOptRequest = await req.json().catch(() => ({} as HedgeOptRequest));
  body.org_id = await resolveOrg(auth, body.org_id ?? null);

  const res = await fetch(`${ANALYTICS_URL}/optimize/hedge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": ANALYTICS_KEY },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    return json({ error: "Analytics service error", detail: err }, 502);
  }

  return json(await res.json());
}));
