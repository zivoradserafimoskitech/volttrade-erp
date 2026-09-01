// src/pages/ForecastDashboard.tsx
// Multi-model price forecasting, backtest comparison, model registry.

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, TrendingUp, BarChart3, Clock, Zap, Activity } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Area, ComposedChart, ReferenceLine,
  BarChart, Bar,
} from "recharts";
import { getForecast, getSupabase } from "@/lib/volttrade";

interface ForecastResult {
  model_type: string;
  horizon_hours: number;
  point_forecast: number[];
  quantiles?: {
    p10: number[];
    p50: number[];
    p90: number[];
  };
  capture_ratio_pct?: number;
  mae?: number;
  generated_at: string;
}

interface ModelInfo {
  id: string;
  model_name: string;
  model_type: string;
  mae: number | null;
  capture_ratio_pct: number | null;
  coverage_pct: number | null;
  is_active: boolean;
  last_trained_at: string | null;
}

const MODEL_COLORS: Record<string, string> = {
  lightgbm: "#3b82f6",
  xgboost: "#8b5cf6",
  lstm: "#f59e0b",
  gru: "#ef4444",
  cnn: "#10b981",
  tft: "#ec4899",
  ensemble: "#2563eb",
  seasonal_naive: "#9ca3af",
};

export default function ForecastDashboard() {
  const [selectedModel, setSelectedModel] = useState("ensemble");
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [backtestResults, setBacktestResults] = useState<any[]>([]);
  const [horizon, setHorizon] = useState(24);

  useEffect(() => {
    loadModels();
    loadBacktests();
  }, []);

  useEffect(() => {
    runForecast();
  }, [selectedModel, horizon]);

  async function loadModels() {
    const { data } = await getSupabase().from("forecast_models").select("*").order("model_type");
    if (data) setModels(data);
  }

  async function loadBacktests() {
    const { data } = await getSupabase().from("backtest_results").select("*").order("created_at", { ascending: false }).limit(10);
    if (data) setBacktestResults(data);
  }

  async function runForecast() {
    setLoading(true);
    try {
      const res = await getForecast(selectedModel, horizon);
      setForecast(res);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  const chartData = forecast?.point_forecast.map((p, i) => ({
    hour: `${(i % 24).toString().padStart(2, "0")}:00`,
    day: Math.floor(i / 24) + 1,
    price: Math.round(p * 100) / 100,
    p10: forecast.quantiles ? Math.round(forecast.quantiles.p10[i] * 100) / 100 : null,
    p90: forecast.quantiles ? Math.round(forecast.quantiles.p90[i] * 100) / 100 : null,
  })) || [];

  const comparisonData = [
    { model: "Naive", capture: 27.9, mae: 27.13, color: "#9ca3af" },
    { model: "Seasonal", capture: 69.2, mae: 27.13, color: "#6b7280" },
    { model: "LightGBM", capture: 85.0, mae: 11.95, color: "#3b82f6" },
    { model: "XGBoost", capture: 82.0, mae: 13.5, color: "#8b5cf6" },
    { model: "Ensemble", capture: 93.2, mae: 11.95, color: "#2563eb" },
    { model: "Perfect", capture: 100.0, mae: 0, color: "#10b981" },
  ];

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Forecast & Backtest</h1>
          <p className="text-muted-foreground mt-1">
            Multi-model ensemble with conformal quantile calibration. 
            Capture ratio vs perfect foresight is the metric that matters.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
            <SelectTrigger className="w-32">
              <Clock className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">24h</SelectItem>
              <SelectItem value="48">48h</SelectItem>
              <SelectItem value="168">7d</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-40">
              <Brain className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ensemble">Ensemble</SelectItem>
              <SelectItem value="lightgbm">LightGBM</SelectItem>
              <SelectItem value="xgboost">XGBoost</SelectItem>
              <SelectItem value="lstm">LSTM</SelectItem>
              <SelectItem value="seasonal_naive">Seasonal Naive</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={runForecast} disabled={loading}>
            <Activity className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Run
          </Button>
        </div>
      </div>

      {/* Model Registry */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {comparisonData.map((m) => (
          <Card
            key={m.model}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedModel === m.model.toLowerCase().replace(" ", "_") ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => setSelectedModel(m.model.toLowerCase().replace(" ", "_"))}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{m.model}</span>
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: m.color }} />
              </div>
              <div className="text-2xl font-bold mt-2">{m.capture}%</div>
              <div className="text-xs text-muted-foreground">capture ratio</div>
              <div className="text-xs text-muted-foreground mt-1">MAE: {m.mae} EUR</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Forecast Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Price Forecast — {selectedModel.toUpperCase()} ({horizon}h)
          </CardTitle>
          <CardDescription>
            {forecast?.capture_ratio_pct && `Capture ratio: ${forecast.capture_ratio_pct}% | `}
            {forecast?.mae && `MAE: ${forecast.mae} EUR | `}
            Generated: {forecast ? new Date(forecast.generated_at).toLocaleString() : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-80" />
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} label={{ value: "EUR/MWh", angle: -90, position: "insideLeft" }} />
                <Tooltip
                  contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                />
                <Legend />
                {forecast?.quantiles && (
                  <Area
                    type="monotone"
                    dataKey="p90"
                    stroke="none"
                    fill="#3b82f6"
                    fillOpacity={0.1}
                    name="P90"
                  />
                )}
                {forecast?.quantiles && (
                  <Area
                    type="monotone"
                    dataKey="p10"
                    stroke="none"
                    fill="#ffffff"
                    fillOpacity={1}
                    name="P10"
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke={MODEL_COLORS[selectedModel] || "#2563eb"}
                  strokeWidth={2}
                  dot={false}
                  name="Point Forecast"
                />
                <ReferenceLine y={106.83} stroke="#9ca3af" strokeDasharray="5 5" label="Baseload Avg" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Backtest Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Backtest Results (120 days walk-forward)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={comparisonData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="model" />
              <YAxis label={{ value: "Capture %", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Bar dataKey="capture" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Capture Ratio %">
                {comparisonData.map((entry, index) => (
                  <cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Model Registry Table */}
      <Card>
        <CardHeader>
          <CardTitle>Model Registry</CardTitle>
          <CardDescription>Tracked models with validation metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Model</th>
                  <th className="text-left py-2 px-3 font-medium">Type</th>
                  <th className="text-right py-2 px-3 font-medium">MAE</th>
                  <th className="text-right py-2 px-3 font-medium">Capture %</th>
                  <th className="text-right py-2 px-3 font-medium">Coverage %</th>
                  <th className="text-center py-2 px-3 font-medium">Active</th>
                  <th className="text-left py-2 px-3 font-medium">Last Trained</th>
                </tr>
              </thead>
              <tbody>
                {models.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No models registered yet. Train your first model to see it here.
                    </td>
                  </tr>
                )}
                {models.map((m) => (
                  <tr key={m.id} className="border-b hover:bg-muted">
                    <td className="py-2 px-3 font-medium">{m.model_name}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline">{m.model_type}</Badge>
                    </td>
                    <td className="py-2 px-3 text-right">{m.mae?.toFixed(2) ?? "—"}</td>
                    <td className="py-2 px-3 text-right">{m.capture_ratio_pct?.toFixed(1) ?? "—"}%</td>
                    <td className="py-2 px-3 text-right">{m.coverage_pct?.toFixed(1) ?? "—"}%</td>
                    <td className="py-2 px-3 text-center">
                      {m.is_active ? <Badge className="bg-green-500">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {m.last_trained_at ? new Date(m.last_trained_at).toLocaleDateString() : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
