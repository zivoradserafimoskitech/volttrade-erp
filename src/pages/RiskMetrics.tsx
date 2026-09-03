// src/pages/RiskMetrics.tsx
// CVaR, VaR, efficient frontier, capital capacity — native VoltTrade.

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, TrendingDown, DollarSign, BarChart3, Activity, Settings } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ScatterChart, Scatter, ReferenceLine, Area, ComposedChart,
} from "recharts";
import { getRiskMetrics, getOrgRiskSettings, updateOrgRiskSettings, getMyOrgId } from "@/lib/volttrade";

interface RiskData {
  organization_id: string;
  capital_at_risk_eur: number;
  book: {
    sold_mwh: number;
    bought_mwh: number;
    hedge_ratio: number;
    locked_margin_eur: number;
    avg_sold_price: number;
    avg_bought_price: number;
  };
  risk: {
    var95_eur: number;
    cvar95_eur: number;
    beta: number;
    scenarios: number;
  };
  capacity: {
    max_mwh: number;
    remaining_mwh: number;
    utilization_pct: number;
  };
  policy: {
    min_hedge_ratio: number;
    max_open_position_pct: number;
    open_position_allowed: boolean;
  };
  efficient_frontier: Array<{
    hedge_ratio: number;
    expected_cost: number;
    cvar95: number;
  }>;
  recommendation: string;
}

export default function RiskMetrics() {
  const [riskData, setRiskData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxOpenPct, setMaxOpenPct] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const id = orgId ?? (await getMyOrgId());
      if (!orgId) setOrgId(id);
      const [metrics, settings] = await Promise.all([
        getRiskMetrics(id, 2000),
        getOrgRiskSettings(id),
      ]);
      setRiskData(metrics);
      if (settings?.max_open_position_pct != null) {
        setMaxOpenPct(Number(settings.max_open_position_pct) * 100);
      }
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  async function savePolicy() {
    const id = orgId ?? (await getMyOrgId());
    setSaving(true);
    await updateOrgRiskSettings(id, {
      max_open_position_pct: maxOpenPct / 100,
    });
    setSaving(false);
    await loadData();
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!riskData) {
    return (
      <div className="p-6 space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Failed to load risk metrics</AlertTitle>
          <AlertDescription>{error ?? "Check your analytics service connection."}</AlertDescription>
        </Alert>
        <Button onClick={loadData}>Retry</Button>
      </div>
    );
  }

  const frontierData = riskData.efficient_frontier.map((f) => ({
    hedgeRatio: f.hedge_ratio,
    expectedCost: f.expected_cost,
    cvar95: f.cvar95,
    risk: f.cvar95 - f.expected_cost,
  }));

  const isAtCapacity = riskData.capacity.remaining_mwh <= 0;
  const isCaution = riskData.capacity.remaining_mwh / riskData.capacity.max_mwh < 0.2;

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Risk Metrics</h1>
          <p className="text-muted-foreground mt-1">
            CVaR, capital capacity, and efficient frontier. Monte Carlo with {riskData.risk.scenarios.toLocaleString()} scenarios.
          </p>
        </div>
        <Badge variant={isAtCapacity ? "destructive" : isCaution ? "secondary" : "default"} className="text-sm px-3 py-1">
          {riskData.recommendation}
        </Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Shield className="h-4 w-4" /> Capital at Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {riskData.capital_at_risk_eur.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">EUR</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Max loss in one bad year without failure
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" /> CVaR 95%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">
              {riskData.risk.cvar95_eur.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">EUR</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Expected loss in worst 5% of scenarios
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" /> VaR 95%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">
              {riskData.risk.var95_eur.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">EUR</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Loss threshold at 95% confidence
            </p>
          </CardContent>
        </Card>

        <Card className={isAtCapacity ? "border-red-500" : isCaution ? "border-yellow-500" : "border-green-500"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {riskData.capacity.utilization_pct}% <span className="text-sm font-normal text-muted-foreground">used</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {riskData.capacity.remaining_mwh.toLocaleString()} MWh remaining of {riskData.capacity.max_mwh.toLocaleString()} MWh max
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Book Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Book Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="text-sm text-muted-foreground">Sold</div>
              <div className="text-2xl font-bold">{riskData.book.sold_mwh.toLocaleString()} MWh</div>
              <div className="text-sm text-muted-foreground">@ {riskData.book.avg_sold_price.toFixed(2)} EUR/MWh</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Bought</div>
              <div className="text-2xl font-bold">{riskData.book.bought_mwh.toLocaleString()} MWh</div>
              <div className="text-sm text-muted-foreground">@ {riskData.book.avg_bought_price.toFixed(2)} EUR/MWh</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Hedge Ratio</div>
              <div className="text-2xl font-bold">{(riskData.book.hedge_ratio * 100).toFixed(1)}%</div>
              <div className="text-sm text-muted-foreground">
                {riskData.book.hedge_ratio >= riskData.policy.min_hedge_ratio ? "✓ Above minimum" : "⚠ Below minimum"}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Locked Margin</div>
              <div className="text-2xl font-bold text-green-600">
                {riskData.book.locked_margin_eur.toLocaleString()} EUR
              </div>
              <div className="text-sm text-muted-foreground">Market-independent profit</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Efficient Frontier */}
      <Card>
        <CardHeader>
          <CardTitle>Efficient Frontier</CardTitle>
          <CardDescription>
            Trade-off between expected cost and tail risk (CVaR). 
            Move right = more hedged = lower risk, higher expected cost.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={frontierData} margin={{ top: 16, right: 48, left: 24, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="hedgeRatio"
                type="number"
                domain={[0, 100]}
                ticks={[0, 20, 40, 60, 80, 100]}
                tickFormatter={(v) => `${v}%`}
                label={{ value: "Hedge Ratio", position: "insideBottom", offset: -28 }}
              />
              <YAxis yAxisId="left" width={88} tickFormatter={(v: number) => v.toLocaleString()} label={{ value: "Expected Cost (EUR)", angle: -90, position: "insideLeft", offset: -8 }} />
              <YAxis yAxisId="right" width={88} orientation="right" tickFormatter={(v: number) => v.toLocaleString()} label={{ value: "CVaR95 (EUR)", angle: 90, position: "insideRight", offset: -8 }} />
              <Tooltip formatter={(v: number) => v.toLocaleString()} labelFormatter={(l) => `Hedge ratio ${l}%`} />
              <Legend verticalAlign="top" height={32} />
              <ReferenceLine yAxisId="left" y={riskData.risk.cvar95_eur} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label="Current CVaR" />
              <Area yAxisId="left" type="monotone" dataKey="expectedCost" fill="hsl(var(--primary))" stroke="hsl(var(--primary))" fillOpacity={0.25} name="Expected Cost" />
              <Line yAxisId="right" type="monotone" dataKey="cvar95" stroke="hsl(var(--destructive))" strokeWidth={2} name="CVaR 95%" dot />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>

      </Card>

      {/* Policy Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" /> Risk Policy
          </CardTitle>
          <CardDescription>
            Adjust open position tolerance. 0% = strict back-to-back. 
            &gt;0% allows speculative positions up to the limit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="text-sm font-medium">Max Open Position</label>
              <span className="text-sm font-bold">{maxOpenPct.toFixed(0)}%</span>
            </div>
            <Slider
              value={[maxOpenPct]}
              onValueChange={(v) => setMaxOpenPct(v[0])}
              max={50}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Back-to-back (0%)</span>
              <span>Aggressive (50%)</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 p-4 rounded-lg bg-muted">
              <div className="text-sm font-medium">Current Policy</div>
              <div className="text-lg font-bold mt-1">
                {riskData.policy.open_position_allowed ? "Open positions ALLOWED" : "Back-to-back ONLY"}
              </div>
              <div className="text-sm text-muted-foreground">
                Max open: {(riskData.policy.max_open_position_pct * 100).toFixed(0)}%
              </div>
            </div>
            <div className="flex-1 p-4 rounded-lg bg-muted">
              <div className="text-sm font-medium">Min Hedge Ratio</div>
              <div className="text-lg font-bold mt-1">
                {(riskData.policy.min_hedge_ratio * 100).toFixed(0)}%
              </div>
              <div className="text-sm text-muted-foreground">
                Below this = breach alert
              </div>
            </div>
          </div>

          <Button onClick={savePolicy} disabled={saving} className="w-full">
            {saving ? "Saving..." : "Update Risk Policy"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
