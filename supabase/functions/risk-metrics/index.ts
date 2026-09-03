// supabase/functions/risk-metrics/index.ts
// CVaR, VaR, capital capacity, efficient frontier — native VoltTrade.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, handler, json, resolveOrg } from "../_shared/auth.ts";

interface RiskRequest {
  org_id?: string;
  scenario_count?: number;
  days?: number;
}

// SECURITY REPAIR 2026-09-01
// --------------------------
// This function previously took `org_id` straight from the request body and
// only fell back to the Bearer token when it was absent — so passing an org id
// bypassed authentication completely. It runs on the service-role key (RLS does
// not apply) and deploy-risk-module.yml shipped it with --no-verify-jwt, which
// made another tenant's VaR, position and hedge ratio readable by anyone.
//
// Now: authenticate() first, resolveOrg() decides the tenant, and a body org_id
// that disagrees with the caller's membership is a 403.
serve(handler(async (req) => {
  const auth = await authenticate(req);
  const supabase = auth.admin;

  const body: RiskRequest = await req.json().catch(() => ({} as RiskRequest));
  const orgId = await resolveOrg(auth, body.org_id ?? null);


    // 1. Org settings
    const { data: risk } = await supabase
      .from("org_risk_settings")
      .select("*")
      .eq("organization_id", orgId)
      .single();

    const capital = risk?.capital_at_risk_eur || 10000;
    const beta = risk?.cvar_beta || 0.95;
    const lambda = risk?.risk_aversion_lambda || 1.0;
    const minHedge = risk?.min_hedge_ratio || 1.0;
    const maxOpen = risk?.max_open_position_pct || 0.0;
    const marginTarget = risk?.margin_target_eur_mwh || 8.0;

    // 2. Active book
    const { data: contracts } = await supabase
      .from("supply_contracts")
      .select("annual_volume_mwh, price_eur_mwh, profile_key, start_date, end_date")
      .eq("organization_id", orgId)
      .eq("status", "active");

    const { data: trades } = await supabase
      .from("trades")
      .select("volume_mwh, price_eur_mwh, side, shape_key, delivery_start, delivery_end")
      .eq("organization_id", orgId)
      .in("status", ["confirmed", "settled", "executed"]);

    const soldMwh = (contracts || []).reduce((s, c) => s + (c.annual_volume_mwh || 0), 0);
    const soldRevenue = (contracts || []).reduce((s, c) => s + (c.annual_volume_mwh || 0) * (c.price_eur_mwh || 0), 0);
    const avgSoldPrice = soldMwh > 0 ? soldRevenue / soldMwh : 0;

    const boughtMwh = (trades || []).filter(t => t.side?.toLowerCase().includes("buy")).reduce((s, t) => s + (t.volume_mwh || 0), 0);
    const boughtCost = (trades || []).filter(t => t.side?.toLowerCase().includes("buy")).reduce((s, t) => s + (t.volume_mwh || 0) * (t.price_eur_mwh || 0), 0);
    const avgBoughtPrice = boughtMwh > 0 ? boughtCost / boughtMwh : 0;

    const lockedMargin = soldRevenue - boughtCost;
    const hedgeRatio = soldMwh > 0 ? boughtMwh / soldMwh : 0;

    // 3. Monte Carlo P&L simulation
    const scenarios = body.scenario_count || 2000;
    const days = body.days || 365;
    const dailySold = soldMwh / 365;
    const dailyBought = boughtMwh / 365;
    const priceVol = 0.25;
    const pnl: number[] = [];

    for (let i = 0; i < scenarios; i++) {
      let scenarioPnl = 0;
      for (let d = 0; d < days; d++) {
        const priceShock = (Math.random() - 0.5) * 2 * priceVol / Math.sqrt(365);
        const spotPrice = avgBoughtPrice * (1 + priceShock);
        const openPct = Math.max(0, 1 - hedgeRatio);
        const dayPnl = dailySold * avgSoldPrice - dailyBought * avgBoughtPrice - dailySold * openPct * (spotPrice - avgBoughtPrice);
        scenarioPnl += dayPnl;
      }
      pnl.push(scenarioPnl);
    }

    pnl.sort((a, b) => a - b);
    const varIdx = Math.floor((1 - beta) * scenarios);
    const var95 = pnl[varIdx];
    const cvar95 = pnl.slice(0, varIdx).reduce((a, b) => a + b, 0) / varIdx;

    // 4. Capacity
    const maxCapacity = capital / (marginTarget * 1.5);
    const remaining = maxCapacity - soldMwh;

    // 5. Profile breakdown
    type ProfileAgg = Record<string, { mwh: number; revenue: number; count: number }>;
    const profileBreakdown = (contracts || []).reduce((acc: ProfileAgg, c: Record<string, number | string | null>) => {
      const key = c.profile_key || 'unknown';
      if (!acc[key]) acc[key] = { mwh: 0, revenue: 0, count: 0 };
      acc[key].mwh += c.annual_volume_mwh || 0;
      acc[key].revenue += (c.annual_volume_mwh || 0) * (c.price_eur_mwh || 0);
      acc[key].count += 1;
      return acc;
    }, {});

    // 6. Efficient frontier
    const frontier = [];
    for (let h = 0; h <= 1; h += 0.25) {
      const hedgePct = h;
      const openPct = 1 - hedgePct;
      if (openPct > maxOpen + 0.001) continue;
      const eCost = boughtCost * hedgePct + soldMwh * avgBoughtPrice * openPct;
      const tailPrice = avgBoughtPrice * 1.4;
      const tailCost = soldMwh * (hedgePct * avgBoughtPrice + openPct * tailPrice);
      frontier.push({
        hedge_ratio: Math.round(hedgePct * 100),
        open_pct: Math.round(openPct * 100),
        expected_cost: Math.round(eCost),
        cvar95_cost: Math.round(tailCost),
      });
    }

    const recommendation = remaining < 0 ? "STOP — at capacity limit"
      : remaining / maxCapacity < 0.2 ? "CAUTION — less than 20% headroom"
      : hedgeRatio < minHedge ? "URGENT — hedge ratio below minimum"
      : "OK — comfortable headroom";

    const result = {
      organization_id: orgId,
      capital_at_risk_eur: capital,
      book: {
        sold_mwh: Math.round(soldMwh),
        bought_mwh: Math.round(boughtMwh),
        hedge_ratio: Math.round(hedgeRatio * 100) / 100,
        locked_margin_eur: Math.round(lockedMargin),
        avg_sold_price: Math.round(avgSoldPrice * 100) / 100,
        avg_bought_price: Math.round(avgBoughtPrice * 100) / 100,
      },
      profile_breakdown: profileBreakdown,
      risk: {
        var95_eur: Math.round(var95),
        cvar95_eur: Math.round(cvar95),
        beta,
        scenarios,
      },
      capacity: {
        max_mwh: Math.round(maxCapacity),
        remaining_mwh: Math.round(remaining),
        utilization_pct: Math.round((soldMwh / maxCapacity) * 100),
      },
      policy: {
        min_hedge_ratio: minHedge,
        max_open_position_pct: maxOpen,
        open_position_allowed: maxOpen > 0,
      },
      efficient_frontier: frontier,
      recommendation,
    };

  return json(result);
}));
