// supabase/functions/analytics-db/index.ts
//
// PostgREST proxy for the external Python analytics service (Render).
//
// WHY THIS EXISTS
// ---------------
// The analytics service writes results back with
//     requests.get/post/patch/delete(f"{SUPABASE_URL}/rest/v1/{table}", headers={apikey, Authorization})
// which normally requires the service-role key. That key cannot be handed to a
// third-party host. This function accepts exactly the same request shape,
// authenticates it with VOLTTRADE_ANALYTICS_KEY (the key the edge functions
// already share with Render), enforces a table whitelist, and forwards it to
// the real PostgREST using the service key that never leaves the backend.
//
// ON RENDER, set:
//     SUPABASE_URL              = https://<project>.functions.supabase.co/analytics-db
//     SUPABASE_SERVICE_ROLE_KEY = <VOLTTRADE_ANALYTICS_KEY>
// No Python changes are needed — the /rest/v1/<table> paths still line up.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANALYTICS_KEY = Deno.env.get("VOLTTRADE_ANALYTICS_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, range, x-api-key",
  "Access-Control-Expose-Headers": "content-range",
};

// Only tables the analytics pipeline legitimately reads or writes.
const ALLOWED_TABLES = new Set([
  "market_price_history",
  "market_prices",
  "load_history",
  "forecast_models",
  "forecast_predictions",
  "backtest_results",
  "retrain_log",
  "bess_dispatch_schedules",
  "arbitrage_opportunities",
  "alerts",
  "assets",
  "sites",
  "org_risk_settings",
  "profile_capture_factors",
]);

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PATCH", "DELETE"]);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!ANALYTICS_KEY || !SERVICE_KEY || !SUPABASE_URL) {
    return json({ error: "Proxy misconfigured" }, 500);
  }

  // Accept the key from any of the headers the Python client may send.
  const auth = req.headers.get("Authorization") ?? "";
  const presented =
    req.headers.get("x-api-key") ??
    req.headers.get("apikey") ??
    (auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");

  if (!timingSafeEqual(presented, ANALYTICS_KEY)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!ALLOWED_METHODS.has(req.method)) {
    return json({ error: `Method ${req.method} not allowed` }, 405);
  }

  const url = new URL(req.url);
  // Path arrives as /analytics-db/rest/v1/<table> (or /rest/v1/<table>).
  const match = url.pathname.match(/\/rest\/v1\/([^/?]+)/);
  if (!match) {
    return json({ error: "Only /rest/v1/<table> paths are proxied" }, 404);
  }
  const table = decodeURIComponent(match[1]);
  if (!ALLOWED_TABLES.has(table)) {
    return json({ error: `Table '${table}' is not proxied` }, 403);
  }

  const target = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  target.search = url.search;

  const headers = new Headers({
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": req.headers.get("Content-Type") ?? "application/json",
  });
  for (const h of ["Prefer", "Range", "Accept", "Content-Profile", "Accept-Profile"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const hasBody = req.method === "POST" || req.method === "PATCH";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
    });
  } catch (e) {
    console.error("analytics-db upstream error:", e);
    return json({ error: "Upstream request failed" }, 502);
  }

  const out = new Headers(corsHeaders);
  for (const h of ["Content-Type", "Content-Range", "Prefer-Applied"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!upstream.ok) {
    console.error(`analytics-db ${req.method} ${table} -> ${upstream.status}`);
  }
  return new Response(await upstream.text(), { status: upstream.status, headers: out });
});
