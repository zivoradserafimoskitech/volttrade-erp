// supabase/functions/forecast-accuracy/index.ts
// Forecast accuracy tracking — native VoltTrade (SPEC-accuracy v1.0, section 4).
//
// POST only. Body: { model_kind?: "price"|"load", zone?: string } — both optional.
// Answers { ok: true, summary: [...], daily: [...] } for the CALLER'S
// organisation:
//
//   summary — rows of public.v_forecast_accuracy (last 30 days, scored rows):
//             organization_id, model_kind, zone, n, mae, rmse, smape, bias,
//             coverage_p10_p90, last_scored_at
//   daily   — last 14 days of scored forecast_predictions grouped by
//             date_trunc('day', target_time) + model_kind: { date, model_kind, mae, n }
//
// SECURITY: org_id is NEVER taken from the request body for interactive
// callers — it is resolved from the caller's membership in
// organization_members (same lookup as risk-metrics / seed-demo-data).
// Only an automated service-role caller (already holding full DB access via
// _shared/auth.ts) may pass org_id explicitly, e.g. for cross-org ops checks.
//
// AuthN/AuthZ via _shared/auth.ts: a staff JWT must hold one of the listed
// roles; the service-role key is recognised as an automated caller.

import { authenticate, handler, json as jsonResponse } from "../_shared/auth.ts";

const PAGE = 1000; // Supabase select cap — paginate, never trust defaults.

interface AccuracyRequest {
  model_kind?: "price" | "load";
  zone?: string;
  org_id?: string; // honoured ONLY for service-role callers (see header note)
}

interface DailyBucket {
  sumAbs: number;
  n: number;
}

Deno.serve(handler(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed — POST only" }, 405);
  }

  const auth = await authenticate(req, { roles: ["admin", "operations", "management"] });
  const supabase = auth.admin;

  const body: AccuracyRequest = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") {
      if (parsed.model_kind === "price" || parsed.model_kind === "load") {
        body.model_kind = parsed.model_kind;
      }
      if (typeof parsed.zone === "string" && parsed.zone.length > 0) {
        body.zone = parsed.zone;
      }
      if (typeof parsed.org_id === "string") body.org_id = parsed.org_id;
    }
  } catch (_) { /* empty/invalid body — no filters */ }

  // Resolve the caller's organisation. Body org_id is ignored for users.
  let orgId: string | null = null;
  if (auth.kind === "user") {
    const { data: mem, error: memErr } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", auth.userId)
      .limit(1)
      .maybeSingle();
    if (memErr) return jsonResponse({ ok: false, error: memErr.message }, 500);
    orgId = mem?.organization_id ?? null;
    if (!orgId) {
      return jsonResponse({ ok: false, error: "Caller has no organisation membership" }, 403);
    }
  } else {
    // Automated service-role caller: trusted, but must still say which org.
    orgId = body.org_id ?? null;
    if (!orgId) {
      return jsonResponse({ ok: false, error: "org_id required for service-role callers" }, 400);
    }
  }

  // ── Summary: last-30-day aggregates from the SQL view ────────────────────
  let q = supabase
    .from("v_forecast_accuracy")
    .select("organization_id, model_kind, zone, n, mae, rmse, smape, bias, coverage_p10_p90, last_scored_at")
    .eq("organization_id", orgId);
  if (body.model_kind) q = q.eq("model_kind", body.model_kind);
  if (body.zone) q = q.eq("zone", body.zone);
  const { data: summary, error: sumErr } = await q;
  if (sumErr) return jsonResponse({ ok: false, error: sumErr.message }, 500);

  // ── Daily: last 14 days of scored rows, aggregated in-function ───────────
  // (PostgREST cannot GROUP BY date_trunc over the REST API; the raw rows are
  // few — 14 days × hours × zones — and we paginate at the 1000-row cap.)
  const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const rows: { target_time: string; model_kind: string; p50: number | null; actual: number | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    let dq = supabase
      .from("forecast_predictions")
      .select("target_time, model_kind, p50, actual")
      .eq("organization_id", orgId)
      .not("actual", "is", null)
      .gte("target_time", since)
      .order("target_time", { ascending: true })
      .range(from, from + PAGE - 1);
    if (body.model_kind) dq = dq.eq("model_kind", body.model_kind);
    if (body.zone) dq = dq.eq("zone", body.zone);
    const { data, error } = await dq;
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    if (data) rows.push(...data);
    if (!data || data.length < PAGE) break;
  }

  const buckets = new Map<string, DailyBucket>();
  for (const r of rows) {
    if (r.p50 === null || r.actual === null) continue;
    const day = new Date(r.target_time).toISOString().slice(0, 10); // UTC day
    const key = `${day}|${r.model_kind}`;
    const b = buckets.get(key) ?? { sumAbs: 0, n: 0 };
    b.sumAbs += Math.abs(r.actual - r.p50);
    b.n += 1;
    buckets.set(key, b);
  }
  const daily = [...buckets.entries()]
    .map(([key, b]) => {
      const [date, model_kind] = key.split("|");
      return { date, model_kind, mae: b.n > 0 ? b.sumAbs / b.n : null, n: b.n };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.model_kind.localeCompare(b.model_kind));

  return jsonResponse({ ok: true, summary: summary ?? [], daily });
}));
