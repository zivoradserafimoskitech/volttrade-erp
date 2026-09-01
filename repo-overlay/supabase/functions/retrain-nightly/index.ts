// supabase/functions/retrain-nightly/index.ts
// Weekly champion/challenger retrain with drift detection.
// Thin proxy: delegates to the Python analytics service (POST /retrain),
// same as forecast-price delegates to POST /forecast.
//
// AuthN/AuthZ via _shared/auth.ts: an interactive staff JWT must hold one of
// the listed roles; pg_cron presents the service-role key and is recognised
// as an automated caller (a service-role JWT has no `sub`, so auth.getUser()
// would 401 — see the P0-3 note in _shared/auth.ts).

import { authenticate, handler, json as jsonResponse } from "../_shared/auth.ts";

// Same fallback as forecast-price: without the secret the service is assumed
// to run alongside (local dev).
const ANALYTICS_URL = Deno.env.get("VOLTTRADE_ANALYTICS_URL") || "http://localhost:8000";
const ANALYTICS_KEY = Deno.env.get("VOLTTRADE_ANALYTICS_KEY") || "";

interface RetrainRequest {
  org_id?: string;
}

Deno.serve(handler(async (req) => {
  const auth = await authenticate(req, { roles: ["admin", "operations", "management"] });

  let body: RetrainRequest = {};
  if (req.method === "POST") {
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed.org_id === "string") body.org_id = parsed.org_id;
    } catch (_) { /* empty/invalid body — retrain across all organisations */ }
  }

  // FastAPI reads org_id as a QUERY parameter (same convention as /ingest/memo),
  // not from the JSON body — append it to the URL when present.
  const upstreamUrl = new URL(`${ANALYTICS_URL}/retrain`);
  if (body.org_id) upstreamUrl.searchParams.set("org_id", body.org_id);

  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The FastAPI auth middleware in python-service/main.py reads exactly
      // this header (X-API-Key) and compares it to VOLTTRADE_ANALYTICS_KEY.
      "X-API-Key": ANALYTICS_KEY,
    },
    body: "{}",
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return jsonResponse(
      { ok: false, error: "Analytics service error", detail: err },
      502,
    );
  }

  // run_retrain() contract: { promoted, champion_mae, challenger_mae, drift, notes }
  const result = await upstream.json();
  return jsonResponse({ ok: true, result, caller: auth.kind });
}));
