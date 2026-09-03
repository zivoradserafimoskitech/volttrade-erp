// supabase/functions/retrain-nightly/index.ts
// Weekly champion/challenger retrain with drift detection.
// Thin proxy: delegates to the Python analytics service (POST /retrain),
// same as forecast-price delegates to POST /forecast.
//
// Since analytics v2.2.0, POST /retrain is ASYNC: it starts the retrain in
// a background job and answers { job_id, status: "accepted" } immediately.
// We request model_kind=all (price + portfolio load). No polling here —
// the pipeline persists promoted champions to forecast_models itself.
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

  // GET ?job_id=... proxies the async job poll so the UI can show progress.
  const reqUrl = new URL(req.url);
  const pollId = reqUrl.searchParams.get("job_id");
  if (req.method === "GET" && pollId) {
    const statusUrl = new URL(`${ANALYTICS_URL}/retrain/status`);
    statusUrl.searchParams.set("job_id", pollId);
    try {
      const r = await fetch(statusUrl, { headers: { "X-API-Key": ANALYTICS_KEY } });
      if (!r.ok) {
        return jsonResponse(
          { ok: false, status: "unknown", error: `analytics status ${r.status}` },
          r.status === 404 ? 404 : 503,
        );
      }
      const body = await r.json();
      return jsonResponse({ ok: true, ...body }, 200);
    } catch (e) {
      return jsonResponse(
        { ok: false, status: "unknown", error: String((e as Error)?.message ?? e) },
        503,
      );
    }
  }

  const body: RetrainRequest = {};
  if (req.method === "POST") {
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed.org_id === "string") body.org_id = parsed.org_id;
    } catch (_) { /* empty/invalid body — retrain across all organisations */ }
  }

  // FastAPI reads org_id as a QUERY parameter (same convention as /ingest/memo),
  // not from the JSON body — append it to the URL when present.
  // model_kind=all retrains both the price and the portfolio load models.
  const upstreamUrl = new URL(`${ANALYTICS_URL}/retrain`);
  if (body.org_id) upstreamUrl.searchParams.set("org_id", body.org_id);
  upstreamUrl.searchParams.set("model_kind", "all");

  // Render free tier cold-starts: the first hit can return 502/503/504 with an
  // empty body while the container boots. Retry a few times with backoff.
  const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
  let upstream: Response | null = null;
  let lastDetail = "";

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 4000 * attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The FastAPI auth middleware in python-service/main.py reads exactly
          // this header (X-API-Key) and compares it to VOLTTRADE_ANALYTICS_KEY.
          "X-API-Key": ANALYTICS_KEY,
        },
        body: "{}",
        signal: controller.signal,
      });
      if (res.ok) { upstream = res; break; }
      lastDetail = (await res.text()) || `upstream status ${res.status}`;
      if (!RETRYABLE.has(res.status)) {
        return jsonResponse({ ok: false, error: "Analytics service error", detail: lastDetail }, 502);
      }
    } catch (e) {
      lastDetail = String((e as Error)?.message ?? e);
    } finally {
      clearTimeout(timer);
    }
  }

  if (!upstream) {
    return jsonResponse(
      {
        ok: false,
        error: "Analytics service unavailable",
        detail: lastDetail ||
          "The analytics service did not respond (cold start). Try again in a minute.",
      },
      503,
    );
  }


  // Async /retrain contract (analytics v2.2.0): { job_id, status: "accepted", model_kind }
  const accepted = await upstream.json();
  return jsonResponse(
    {
      ok: true,
      job_id: accepted.job_id ?? null,
      note: "retrain started; results land in forecast_models",
      caller: auth.kind,
    },
    202,
  );
}));
