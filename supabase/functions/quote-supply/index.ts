// supabase/functions/quote-supply/index.ts
// Native VoltTrade edge function — profile-based supply quoting.
// Uses measured capture factors, not baseload guesswork.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QuoteRequest {
  lead_quote_id?: string;
  profile_key: string;
  annual_mwh: number;
  baseload_price?: number;
  margin_eur_mwh?: number;
  volume_sigma?: number;
  start_date?: string;
  end_date?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: QuoteRequest = await req.json();
    const { lead_quote_id, profile_key, annual_mwh, baseload_price, margin_eur_mwh, volume_sigma, start_date, end_date } = body;

    // Resolve org from auth context
    const authHeader = req.headers.get("Authorization");
    let organization_id: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: mem } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", user.id)
          .single();
        if (mem) organization_id = mem.organization_id;
      }
    }

    if (!organization_id && lead_quote_id) {
      const { data: lq } = await supabase
        .from("lead_quotes")
        .select("organization_id")
        .eq("id", lead_quote_id)
        .single();
      if (lq) organization_id = lq.organization_id;
    }

    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id required" }), 
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Fetch org risk settings
    const { data: risk } = await supabase
      .from("org_risk_settings")
      .select("margin_target_eur_mwh, volume_sigma_default, capital_at_risk_eur, max_open_position_pct")
      .eq("organization_id", organization_id)
      .single();

    const margin = margin_eur_mwh ?? risk?.margin_target_eur_mwh ?? 8.0;
    const sigma = volume_sigma ?? risk?.volume_sigma_default ?? 0.15;
    const maxOpenPct = risk?.max_open_position_pct ?? 0.0;

    // 2. Fetch measured capture factor
    const { data: pcf, error: pcfErr } = await supabase
      .from("profile_capture_factors")
      .select("capture_factor, note")
      .eq("profile_key", profile_key)
      .single();

    if (pcfErr || !pcf) {
      return new Response(JSON.stringify({ error: `Unknown profile: ${profile_key}` }), 
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Fetch latest baseload forward price
    let baseload = baseload_price;
    if (!baseload) {
      const { data: fwd } = await supabase
        .from("market_price_history")
        .select("price_eur_mwh")
        .eq("organization_id", organization_id)
        .eq("product", "baseload_year")
        .order("timestamp", { ascending: false })
        .limit(1)
        .single();
      baseload = fwd?.price_eur_mwh ?? 106.83;
    }

    // 4. Calculate profile-corrected price
    const capturedPrice = baseload * pcf.capture_factor;
    const volPremium = sigma * Math.sqrt(12) * 3.7;
    const requiredPrice = capturedPrice + margin + volPremium;
    const offerPrice = Math.round(requiredPrice * 100) / 100;

    // 5. Risk capacity check
    const { data: book } = await supabase
      .from("supply_contracts")
      .select("annual_volume_mwh")
      .eq("organization_id", organization_id)
      .eq("status", "active");
    const totalSold = (book || []).reduce((s, r) => s + (r.annual_volume_mwh || 0), 0);
    const safetyFactor = 1.5;
    const maxCapacity = (risk?.capital_at_risk_eur || 10000) / (margin * safetyFactor);
    const capacityOk = (totalSold + annual_mwh) <= maxCapacity;

    // 6. Competitive comparison
    const competitorPrice = baseload * 1.12;  // typical competitor markup
    const savingsVsCompetitor = Math.round((competitorPrice - offerPrice) * 100) / 100;

    // 7. Update lead_quote if provided
    if (lead_quote_id) {
      await supabase.from("lead_quotes").update({
        base_price_eur_mwh: Math.round(baseload * 100) / 100,
        margin_eur_mwh: margin,
        total_price_eur_mwh: offerPrice,
        profile_key,
        capture_factor: pcf.capture_factor,
        captured_price_eur_mwh: Math.round(capturedPrice * 100) / 100,
        volume_risk_premium_eur_mwh: Math.round(volPremium * 100) / 100,
        required_price_eur_mwh: Math.round(requiredPrice * 100) / 100,
        risk_capacity_ok: capacityOk,
        start_date: start_date ?? new Date().toISOString().split("T")[0],
        end_date: end_date ?? new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split("T")[0],
        updated_at: new Date().toISOString(),
      }).eq("id", lead_quote_id);
    }

    const result = {
      profile_key,
      capture_factor: pcf.capture_factor,
      baseload_price: Math.round(baseload * 100) / 100,
      captured_price: Math.round(capturedPrice * 100) / 100,
      margin_eur_mwh: margin,
      volume_risk_premium: Math.round(volPremium * 100) / 100,
      required_price: Math.round(requiredPrice * 100) / 100,
      offer_price: offerPrice,
      annual_mwh,
      estimated_annual_margin: Math.round(annual_mwh * margin),
      capacity_check: {
        current_sold_mwh: totalSold,
        proposed_total_mwh: totalSold + annual_mwh,
        max_capacity_mwh: Math.round(maxCapacity),
        ok: capacityOk,
      },
      competitive: {
        competitor_price: Math.round(competitorPrice * 100) / 100,
        savings_vs_competitor: savingsVsCompetitor,
        savings_pct: Math.round((savingsVsCompetitor / competitorPrice) * 1000) / 10,
      },
      open_position_allowed: maxOpenPct > 0,
      note: pcf.note,
    };

    return new Response(JSON.stringify(result), 
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
