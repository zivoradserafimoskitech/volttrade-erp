// src/lib/volttrade.ts
// Native VoltTrade API client — risk, forecast, and optimization.
// All functions are org-scoped via RLS.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ANALYTICS_URL = import.meta.env.VITE_VOLTTRADE_ANALYTICS_URL || "http://localhost:8000";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Missing Supabase environment variables");
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// ── Edge Functions ────────────────────────────────────────────────────────

export async function quoteSupply(payload: {
  lead_quote_id?: string;
  profile_key: string;
  annual_mwh: number;
  baseload_price?: number;
  margin_eur_mwh?: number;
  volume_sigma?: number;
  start_date?: string;
  end_date?: string;
}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/quote-supply`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getRiskMetrics(orgId: string, scenarios?: number) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/risk-metrics`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ org_id: orgId, scenarios }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getForecast(modelType: string = "ensemble", horizon: number = 24) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/forecast-price`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model_type: modelType, horizon_hours: horizon, include_quantiles: true }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function optimizeHedge(orgId: string, targetRatio?: number) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/optimize-hedge`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ org_id: orgId, target_hedge_ratio: targetRatio }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestMemo(date?: string, orgId?: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest-memo`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ date, org_id: orgId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Direct Supabase Queries ───────────────────────────────────────────────

export async function getHourlyPosition(date: string) {
  const { data, error } = await getSupabase()
    .from("v_hourly_position")
    .select("*")
    .eq("delivery_date", date)
    .order("hour_of_day", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getHedgeBreaches() {
  const { data, error } = await getSupabase()
    .from("v_hedge_breaches")
    .select("*")
    .order("delivery_date", { ascending: true })
    .limit(30);
  if (error) throw error;
  return data;
}

export async function getCaptureFactors() {
  const { data, error } = await getSupabase()
    .from("profile_capture_factors")
    .select("*")
    .order("capture_factor", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getOrgRiskSettings(orgId: string) {
  const { data, error } = await getSupabase()
    .from("org_risk_settings")
    .select("*")
    .eq("organization_id", orgId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateOrgRiskSettings(orgId: string, settings: Record<string, any>) {
  const { data, error } = await getSupabase()
    .from("org_risk_settings")
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId);
  if (error) throw error;
  return data;
}

export async function getLeadQuotes(orgId: string) {
  const { data, error } = await getSupabase()
    .from("lead_quotes")
    .select("*, profile_capture_factors(capture_factor, note)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getForecastModels(orgId: string) {
  const { data, error } = await getSupabase()
    .from("forecast_models")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getBacktestResults(orgId: string) {
  const { data, error } = await getSupabase()
    .from("backtest_results")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data;
}
