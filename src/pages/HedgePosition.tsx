// src/pages/HedgePosition.tsx
// THE screen you look at every morning. Empty breaches = sleep well.

import { useEffect, useState, useCallback } from "react";
import { useSupabaseClient } from "@supabase/auth-helpers-react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, ShieldCheck, TrendingUp, TrendingDown, RefreshCw,
  Calendar, Clock, Zap, DollarSign, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Line, Area, ReferenceLine,
} from "recharts";

interface PositionHour {
  delivery_date: string;
  hour_of_day: number;
  sold_mwh: number;
  bought_mwh: number;
  open_mwh: number;
}

interface Breach {
  delivery_date: string;
  worst_open_mwh: number;
  worst_hour: number;
  net_open_mwh: number;
  hedge_ratio: number | null;
  total_short_mwh: number;
  total_long_mwh: number;
}

export default function HedgePosition() {
  const supabase = useSupabaseClient();
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [position, setPosition] = useState<PositionHour[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const [{ data: bData }, { data: pData }] = await Promise.all([
      supabase.from("v_hedge_breaches").select("*").order("delivery_date", { ascending: true }).limit(30),
      supabase.from("v_hourly_position").select("*")
        .eq("delivery_date", selectedDate)
        .order("hour_of_day", { ascending: true }),
    ]);

    setBreaches(bData || []);
    setPosition(pData || []);
    setLoading(false);
  }, [supabase, selectedDate]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const isBreach = breaches.length > 0;
  const totalSold = position.reduce((s, p) => s + (p.sold_mwh || 0), 0);
  const totalBought = position.reduce((s, p) => s + (p.bought_mwh || 0), 0);
  const worstOpen = position.reduce((max, p) => Math.max(max, Math.abs(p.open_mwh || 0)), 0);
  const netOpen = position.reduce((s, p) => s + (p.open_mwh || 0), 0);

  // Chart data
  const chartData = position.map((h) => ({
    hour: `${h.hour_of_day.toString().padStart(2, "0")}:00`,
    sold: Math.round(h.sold_mwh * 100) / 100,
    bought: Math.round(h.bought_mwh * 100) / 100,
    open: Math.round(h.open_mwh * 100) / 100,
    short: h.open_mwh > 0 ? Math.round(h.open_mwh * 100) / 100 : 0,
    long: h.open_mwh < 0 ? Math.round(Math.abs(h.open_mwh) * 100) / 100 : 0,
  }));

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hourly Hedge Position</h1>
          <p className="text-muted-foreground mt-1">
            The only screen that matters every morning. Look by hour, not by day.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Badge variant={isBreach ? "destructive" : "default"} className="text-sm px-3 py-1">
            {isBreach ? `${breaches.length} OPEN BREACHES` : "ALL HEDGED ✓"}
          </Badge>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={isBreach ? "border-red-500 shadow-red-100" : "border-green-500 shadow-green-100"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Hedge Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {isBreach ? (
                <AlertTriangle className="h-6 w-6 text-red-500" />
              ) : (
                <ShieldCheck className="h-6 w-6 text-green-500" />
              )}
              <span className={`text-3xl font-bold ${isBreach ? "text-red-600" : "text-green-600"}`}>
                {isBreach ? "BREACH" : "OK"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isBreach ? "Open position detected — action required" : "Back-to-back verified"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4" /> Worst Hour Exposure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{worstOpen.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">MWh</span></div>
            <p className="text-xs text-muted-foreground mt-1">
              Largest hourly mismatch
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Sold / Bought
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {totalSold.toFixed(0)} <span className="text-sm font-normal text-muted-foreground">/ {totalBought.toFixed(0)} MWh</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Volume hedge ratio: {totalSold > 0 ? ((totalBought/totalSold)*100).toFixed(1) : 0}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Net Open
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${netOpen > 0 ? "text-red-600" : netOpen < 0 ? "text-orange-600" : "text-green-600"}`}>
              {netOpen > 0 ? "+" : ""}{netOpen.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">MWh</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {netOpen > 0 ? "SHORT — need more supply" : netOpen < 0 ? "LONG — over-hedged" : "Balanced"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Breach Alert */}
      {isBreach && (
        <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="text-lg">Open position detected on {breaches.length} delivery day(s)</AlertTitle>
          <AlertDescription>
            The volume hedge ratio is misleading — baseload hedge for a single-shift client gives 100% by volume 
            and is still <strong>+1.04 MW short at 08:00</strong>. Check the hourly chart below.
          </AlertDescription>
        </Alert>
      )}

      {/* Hourly Position Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Hourly Position — {selectedDate}
            </CardTitle>
            <CardDescription>
              Sold (blue) vs Bought (purple) vs Open position (red/green)
            </CardDescription>
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border rounded-md px-3 py-1 text-sm"
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-80 flex items-center justify-center">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} label={{ value: "MWh", angle: -90, position: "insideLeft" }} />
                <Tooltip
                  contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                />
                <Legend />
                <ReferenceLine y={0} stroke="#9ca3af" />
                <Bar dataKey="sold" fill="#3b82f6" name="Sold" opacity={0.8} />
                <Bar dataKey="bought" fill="#a855f7" name="Bought" opacity={0.8} />
                <Bar dataKey="short" fill="#ef4444" name="Short (open)" />
                <Bar dataKey="long" fill="#22c55e" name="Long (open)" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-80 flex items-center justify-center text-muted-foreground">
              No position data for {selectedDate}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Breaches Table */}
      {breaches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> Breach Details
            </CardTitle>
            <CardDescription>Click a row to view that day's hourly breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Date</th>
                    <th className="text-left py-2 px-3 font-medium">Worst Hour</th>
                    <th className="text-right py-2 px-3 font-medium">Worst Open</th>
                    <th className="text-right py-2 px-3 font-medium">Net Open</th>
                    <th className="text-right py-2 px-3 font-medium">Vol Hedge %</th>
                    <th className="text-right py-2 px-3 font-medium">Short</th>
                    <th className="text-right py-2 px-3 font-medium">Long</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.map((b) => (
                    <tr
                      key={b.delivery_date}
                      className="border-b hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => setSelectedDate(b.delivery_date)}
                    >
                      <td className="py-2 px-3 font-medium">{b.delivery_date}</td>
                      <td className="py-2 px-3">{b.worst_hour}:00</td>
                      <td className={`py-2 px-3 text-right font-bold ${b.worst_open_mwh > 0 ? "text-red-600" : "text-green-600"}`}>
                        {b.worst_open_mwh > 0 ? "+" : ""}{b.worst_open_mwh.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">{b.net_open_mwh.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right">
                        {b.hedge_ratio ? `${(b.hedge_ratio * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right text-red-600">{b.total_short_mwh?.toFixed(2) || "—"}</td>
                      <td className="py-2 px-3 text-right text-green-600">{b.total_long_mwh?.toFixed(2) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Capture Factors Reference */}
      <Card>
        <CardHeader>
          <CardTitle>Capture Factors (Measured on 21,993 hours MEMO data)</CardTitle>
          <CardDescription>
            Difference between best (0.801) and worst (1.124) is 32 EUR/MWh in offered price
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { key: "1shift_08_16", label: "1 Shift 08–16", cf: 0.8011, color: "bg-green-100 border-green-300 text-green-800", note: "BEST" },
              { key: "daytime_solar", label: "Daytime Solar", cf: 0.8359, color: "bg-emerald-50 border-emerald-200", note: "Good" },
              { key: "flat_3shift", label: "3 Shifts", cf: 1.0000, color: "bg-blue-50 border-blue-200", note: "Baseline" },
              { key: "2shift_06_22", label: "2 Shifts 06–22", cf: 1.0133, color: "bg-yellow-50 border-yellow-200", note: "Above avg" },
              { key: "weekend_light", label: "Weekend Light", cf: 0.9234, color: "bg-gray-50 border-gray-200", note: "Weekend" },
              { key: "night_heavy", label: "Night Heavy", cf: 1.1245, color: "bg-red-100 border-red-300 text-red-800", note: "WORST" },
            ].map((p) => (
              <div key={p.key} className={`border rounded-lg p-4 ${p.color}`}>
                <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{p.note}</div>
                <div className="text-sm font-medium mt-1">{p.label}</div>
                <div className="text-3xl font-bold mt-2">{p.cf.toFixed(4)}</div>
                <div className="text-xs mt-1 opacity-70">
                  {p.cf < 1 ? "↓ cheaper" : p.cf > 1 ? "↑ expensive" : "baseline"}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
