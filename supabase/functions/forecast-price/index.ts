// supabase/functions/forecast-price/index.ts
// Multi-model price forecast endpoint — native VoltTrade.
// Delegates to the Python analytics service, with a built-in
// seasonal-naive fallback computed from market_prices when that
// service is unreachable (cold start / 5xx / timeout).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYTICS_URL = Deno.env.get("VOLTTRADE_ANALYTICS_URL") || "";
const ANALYTICS_KEY = Deno.env.get("VOLTTRADE_ANALYTICS_KEY") || "";

interface ForecastRequest {
  model_type?: string;
  horizon_hours?: number;
  include_quantiles?: boolean;
  as_of_date?: string;
  zone?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callAnalytics(body: ForecastRequest): Promise<Response | null> {
  if (!ANALYTICS_URL) return null;
  // Two attempts: Render free instances often 502/503 on cold start.
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(`${ANALYTICS_URL}/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": ANALYTICS_KEY },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.ok) return res;
      // 4xx from the service is a real error — surface it.
      if (res.status < 500) return res;
      console.warn(`analytics ${res.status} attempt ${attempt + 1}`);
    } catch (e) {
      console.warn(`analytics fetch failed attempt ${attempt + 1}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

async function localSeasonalNaive(horizon: number, includeQuantiles: boolean) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  const since = new Date(Date.now() - 28 * 24 * 3600 * 1000).toISOString();
  const rows: { delivery_at: string; price_eur_mwh: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("market_prices")
      .select("delivery_at, price_eur_mwh")
      .gte("delivery_at", since)
      .order("delivery_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  if (rows.length === 0) return null;

  // Average by hour-of-day over available history.
  const sums = new Array(24).fill(0);
  const counts = new Array(24).fill(0);
  for (const r of rows) {
    const h = new Date(r.delivery_at).getUTCHours();
    sums[h] += Number(r.price_eur_mwh);
    counts[h]++;
  }
  const overall = rows.reduce((a, r) => a + Number(r.price_eur_mwh), 0) / rows.length;
  const profile = sums.map((s, i) => (counts[i] ? s / counts[i] : overall));

  // Residual spread for quantile bands.
  let sse = 0;
  for (const r of rows) {
    const h = new Date(r.delivery_at).getUTCHours();
    sse += Math.pow(Number(r.price_eur_mwh) - profile[h], 2);
  }
  const sigma = Math.sqrt(sse / rows.length);

  const point: number[] = [];
  const startHour = new Date().getUTCHours() + 1;
  for (let i = 0; i < horizon; i++) point.push(profile[(startHour + i) % 24]);

  let mae = 0;
  for (const r of rows) {
    const h = new Date(r.delivery_at).getUTCHours();
    mae += Math.abs(Number(r.price_eur_mwh) - profile[h]);
  }
  mae /= rows.length;

  return {
    model_type: "seasonal_naive",
    horizon_hours: horizon,
    point_forecast: point,
    quantiles: includeQuantiles
      ? {
          p10: point.map((p) => p - 1.2816 * sigma),
          p50: point.slice(),
          p90: point.map((p) => p + 1.2816 * sigma),
        }
      : undefined,
    mae: Math.round(mae * 100) / 100,
    generated_at: new Date().toISOString(),
    fallback: true,
    fallback_reason: "Analytics service unavailable — local seasonal-naive forecast",
    history_points: rows.length,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: ForecastRequest = await req.json().catch(() => ({}));
    const horizon = Math.min(Math.max(body.horizon_hours ?? 24, 1), 720);
    const includeQuantiles = body.include_quantiles !== false;

    const ALLOWED = [
      "lightgbm", "xgboost", "lstm", "gru", "cnn", "tft",
      "ensemble", "seasonal_naive", "naive",
    ];
    const ALIASES: Record<string, string> = {
      seasonal: "seasonal_naive",
      perfect: "ensemble",
      "perfect_foresight": "ensemble",
    };
    const requested = (body.model_type ?? "ensemble").toLowerCase().replace(/\s+/g, "_");
    const modelType = ALLOWED.includes(requested)
      ? requested
      : (ALIASES[requested] ?? "ensemble");

    const res = await callAnalytics({ ...body, model_type: modelType, horizon_hours: horizon });

    if (res && res.ok) {
      return json(await res.json());
    }

    if (res && !res.ok && res.status < 500) {
      const detail = await res.text();
      return json({ error: "Analytics service rejected the request", detail, status: res.status }, 400);
    }

    // Service down or 5xx — fall back locally so the UI still renders.
    const local = await localSeasonalNaive(horizon, includeQuantiles);
    if (local) return json(local);

    return json(
      {
        error: "Forecast unavailable",
        detail: "Analytics service is unreachable and there is no market price history to fall back on.",
      },
      503,
    );
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
