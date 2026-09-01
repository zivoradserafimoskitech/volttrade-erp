// supabase/functions/optimize-hedge/index.ts
// Stochastic LP + CVaR hedge optimization — native VoltTrade.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYTICS_URL = Deno.env.get("VOLTTRADE_ANALYTICS_URL") || "http://localhost:8000";
const ANALYTICS_KEY = Deno.env.get("VOLTTRADE_ANALYTICS_KEY") || "";

interface HedgeOptRequest {
  org_id: string;
  target_hedge_ratio?: number;
  risk_aversion?: number;
  scenarios?: number;
  capital_at_risk_eur?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: HedgeOptRequest = await req.json();

    const res = await fetch(`${ANALYTICS_URL}/optimize/hedge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": ANALYTICS_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: "Analytics service error", detail: err }), 
        { status: 502, headers: corsHeaders });
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), 
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
