import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { StatCard } from "@/components/erp/StatCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtEur, fmtMwh, fmtNum } from "@/lib/format";
import { exportToExcel, exportToPdf, type ExportColumn } from "@/lib/exports";
import { toast } from "sonner";
import { TrendingUp, Target, AlertTriangle, Gauge, Download, FileSpreadsheet, FileText, Sparkles, RefreshCw, Database } from "lucide-react";
import { format, addDays, subDays, differenceInCalendarDays } from "date-fns";
import { ResponsiveContainer, ComposedChart, Line, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";

type Client = { id: string; company_name: string; fixed_price_eur_mwh: number | null; margin_eur_mwh: number };
type Forecast = { id?: string; client_id: string; forecast_date: string; forecast_mwh: number; budget_mwh: number | null; budget_eur: number | null; method: string; forecast_mwh_external?: number | null; external_source?: string | null; external_synced_at?: string | null };
type Reading = { metering_point_id: string; reading_at: string; actual_mwh: number | null };
type Meter = { id: string; client_id: string };

const HORIZON_DAYS = 90;
const VARIANCE_TOLERANCE = 0.15;

function daysArray(start: Date, count: number) {
  return Array.from({ length: count }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
}

// MAPE across pairs of (actual, forecast) where actual > 0
function mape(pairs: { actual: number; forecast: number }[]) {
  const valid = pairs.filter(p => p.actual > 0);
  if (valid.length === 0) return null;
  const sum = valid.reduce((s, p) => s + Math.abs((p.actual - p.forecast) / p.actual), 0);
  return (sum / valid.length) * 100;
}

export default function Forecasting() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [editing, setEditing] = useState<Record<string, number>>({}); // key `${client_id}|${date}` -> draft mwh
  const [savingKey, setSavingKey] = useState<string>("");
  const [growth, setGrowth] = useState<number>(0);
  const [syncing, setSyncing] = useState(false);

  const horizonDates = useMemo(() => daysArray(new Date(startDate), HORIZON_DAYS), [startDate]);
  const priorYearRange = useMemo(() => {
    const from = subDays(new Date(startDate), 365);
    const to = addDays(from, HORIZON_DAYS + 30);
    return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
  }, [startDate]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const rangeEnd = format(addDays(new Date(startDate), HORIZON_DAYS - 1), "yyyy-MM-dd");
    const [cRes, mRes, fRes, rRes] = await Promise.all([
      supabase.from("clients").select("id, company_name, fixed_price_eur_mwh, margin_eur_mwh").order("company_name"),
      supabase.from("metering_points").select("id, client_id"),
      supabase.from("forecasts").select("id, client_id, forecast_date, forecast_mwh, budget_mwh, budget_eur, method, forecast_mwh_external, external_source, external_synced_at").gte("forecast_date", priorYearRange.from).lte("forecast_date", rangeEnd),
      supabase.from("consumption_readings").select("metering_point_id, reading_at, actual_mwh").gte("reading_at", `${priorYearRange.from}T00:00:00`).lte("reading_at", `${rangeEnd}T23:59:59`).limit(10000),
    ]);
    setClients((cRes.data as any) ?? []);
    setMeters((mRes.data as any) ?? []);
    setForecasts((fRes.data as any) ?? []);
    setReadings((rRes.data as any) ?? []);
    setLoading(false);
  }, [user, startDate, priorYearRange.from]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (clients.length && !selectedClientId) setSelectedClientId(clients[0].id); }, [clients, selectedClientId]);

  // Indices
  const meterToClient = useMemo(() => {
    const m = new Map<string, string>();
    meters.forEach(x => m.set(x.id, x.client_id));
    return m;
  }, [meters]);

  // Actual daily MWh per (client, date)
  const actualByClientDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of readings) {
      const cid = meterToClient.get(r.metering_point_id);
      if (!cid) continue;
      const d = format(new Date(r.reading_at), "yyyy-MM-dd");
      const k = `${cid}|${d}`;
      m.set(k, (m.get(k) ?? 0) + Number(r.actual_mwh ?? 0));
    }
    return m;
  }, [readings, meterToClient]);

  const forecastByKey = useMemo(() => {
    const m = new Map<string, Forecast>();
    forecasts.forEach(f => m.set(`${f.client_id}|${f.forecast_date}`, f));
    return m;
  }, [forecasts]);

  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);

  // Portfolio aggregates over the horizon
  const portfolio = useMemo(() => {
    let forecastMwh = 0;
    let forecastEur = 0;
    let budgetMwh = 0;
    let budgetEur = 0;
    for (const c of clients) {
      const price = Number(c.fixed_price_eur_mwh ?? 0) + Number(c.margin_eur_mwh ?? 0);
      for (const d of horizonDates) {
        const f = forecastByKey.get(`${c.id}|${d}`);
        if (f) {
          forecastMwh += Number(f.forecast_mwh);
          forecastEur += Number(f.forecast_mwh) * price;
          if (f.budget_mwh != null) budgetMwh += Number(f.budget_mwh);
          if (f.budget_eur != null) budgetEur += Number(f.budget_eur);
        }
      }
    }
    return { forecastMwh, forecastEur, budgetMwh, budgetEur };
  }, [clients, horizonDates, forecastByKey]);

  // Accuracy: compare forecasts from last 30 completed days against actuals
  const accuracy = useMemo(() => {
    const today = new Date();
    const pairs: { actual: number; forecast: number }[] = [];
    for (let i = 1; i <= 30; i++) {
      const d = format(subDays(today, i), "yyyy-MM-dd");
      for (const c of clients) {
        const f = forecastByKey.get(`${c.id}|${d}`);
        const a = actualByClientDate.get(`${c.id}|${d}`) ?? 0;
        if (f && Number(f.forecast_mwh) > 0) {
          pairs.push({ forecast: Number(f.forecast_mwh), actual: a });
        }
      }
    }
    return { pairs, mape: mape(pairs) };
  }, [clients, forecastByKey, actualByClientDate]);

  // Variance alerts (MTD horizon): clients where sum(forecast - actual) / forecast > tolerance on already-elapsed days in horizon
  const variance = useMemo(() => {
    const today = new Date();
    const rows: { client_id: string; company_name: string; forecast: number; actual: number; variance: number; daysElapsed: number }[] = [];
    for (const c of clients) {
      let f = 0, a = 0, days = 0;
      for (const d of horizonDates) {
        if (new Date(d) > today) break;
        const fv = forecastByKey.get(`${c.id}|${d}`);
        if (!fv) continue;
        f += Number(fv.forecast_mwh);
        a += actualByClientDate.get(`${c.id}|${d}`) ?? 0;
        days++;
      }
      if (f > 0 && days > 0) rows.push({ client_id: c.id, company_name: c.company_name, forecast: f, actual: a, variance: (a - f) / f, daysElapsed: days });
    }
    return rows.sort((x, y) => Math.abs(y.variance) - Math.abs(x.variance));
  }, [clients, horizonDates, forecastByKey, actualByClientDate]);

  const outOfTolerance = variance.filter(v => Math.abs(v.variance) > VARIANCE_TOLERANCE);

  // Chart for selected client — trailing 30 actual + next 60 forecast
  const chartData = useMemo(() => {
    if (!selectedClientId) return [];
    const today = new Date();
    const series: { date: string; actual: number | null; forecast: number | null; budget: number | null; external: number | null }[] = [];
    for (let i = -30; i < 60; i++) {
      const d = format(addDays(today, i), "yyyy-MM-dd");
      const f = forecastByKey.get(`${selectedClientId}|${d}`);
      const a = actualByClientDate.get(`${selectedClientId}|${d}`);
      series.push({
        date: format(addDays(today, i), "MM-dd"),
        actual: i <= 0 && a != null ? +a.toFixed(3) : null,
        forecast: f ? +Number(f.forecast_mwh).toFixed(3) : null,
        budget: f && f.budget_mwh != null ? +Number(f.budget_mwh).toFixed(3) : null,
        external: f && f.forecast_mwh_external != null ? +Number(f.forecast_mwh_external).toFixed(3) : null,
      });
    }
    return series;
  }, [selectedClientId, forecastByKey, actualByClientDate]);

  // ─── Actions ───
  const syncInflux = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-influx-forecasts", { body: {} });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error ?? "Sync failed");
      } else {
        toast.success(`Synced ${data.synced ?? 0} forecast rows from InfluxDB (${data.meters ?? 0} meters)`);
        await load();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const saveCell = async (clientId: string, date: string, value: number, method: string = "manual") => {
    if (!user) return;
    const key = `${clientId}|${date}`;
    setSavingKey(key);
    const existing = forecastByKey.get(key);
    if (existing?.id) {
      const { error } = await supabase.from("forecasts").update({ forecast_mwh: value, method }).eq("id", existing.id);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase.from("forecasts").insert({
        user_id: user.id, client_id: clientId, forecast_date: date, forecast_mwh: value, method,
      });
      if (error) toast.error(error.message);
    }
    setSavingKey("");
    setEditing(prev => { const n = { ...prev }; delete n[key]; return n; });
    await load();
  };

  const generateSeasonal = async (clientId: string | "all") => {
    if (!user) return;
    const targets = clientId === "all" ? clients.map(c => c.id) : [clientId];
    const rowsToUpsert: any[] = [];
    for (const cid of targets) {
      // Prior-year same-day actual × (1 + growth)
      for (const d of horizonDates) {
        const priorDate = format(subDays(new Date(d), 365), "yyyy-MM-dd");
        const priorActual = actualByClientDate.get(`${cid}|${priorDate}`) ?? 0;
        const projected = +(priorActual * (1 + growth / 100)).toFixed(4);
        if (projected <= 0) continue;
        rowsToUpsert.push({
          user_id: user.id, client_id: cid, forecast_date: d,
          forecast_mwh: projected, method: "seasonal",
        });
      }
    }
    if (rowsToUpsert.length === 0) {
      toast.info("No prior-year consumption found for these clients.");
      return;
    }
    const { error } = await supabase.from("forecasts").upsert(rowsToUpsert, { onConflict: "user_id,client_id,forecast_date" });
    if (error) return toast.error(error.message);
    toast.success(`Generated ${rowsToUpsert.length} forecast rows`);
    await load();
  };

  // ─── Export ───
  const exportGrid = (kind: "xlsx" | "pdf") => {
    const cols: ExportColumn[] = [
      { key: "company_name", label: "Client", format: "text" },
      { key: "forecast_mwh", label: "Forecast 90d (MWh)", format: "num" },
      { key: "actual_mwh", label: "Actual so far (MWh)", format: "num" },
      { key: "budget_mwh", label: "Budget (MWh)", format: "num" },
      { key: "variance_pct", label: "Variance %", format: "pct" },
    ];
    const today = new Date();
    const rows = clients.map(c => {
      let f = 0, a = 0, b = 0;
      for (const d of horizonDates) {
        const fv = forecastByKey.get(`${c.id}|${d}`);
        if (fv) { f += Number(fv.forecast_mwh); if (fv.budget_mwh) b += Number(fv.budget_mwh); }
        if (new Date(d) <= today) a += actualByClientDate.get(`${c.id}|${d}`) ?? 0;
      }
      const variance_pct = f > 0 ? ((a - f) / f) * 100 : 0;
      return { company_name: c.company_name, forecast_mwh: +f.toFixed(2), actual_mwh: +a.toFixed(2), budget_mwh: +b.toFixed(2), variance_pct };
    });
    const totals = {
      company_name: "TOTAL",
      forecast_mwh: rows.reduce((s, r) => s + r.forecast_mwh, 0),
      actual_mwh: rows.reduce((s, r) => s + r.actual_mwh, 0),
      budget_mwh: rows.reduce((s, r) => s + r.budget_mwh, 0),
    };
    const stamp = format(new Date(), "yyyy-MM-dd_HHmm");
    if (kind === "xlsx") exportToExcel(`forecast_90d_${stamp}`, [{ name: "90-day Forecast", columns: cols, rows }]);
    else exportToPdf({
      title: "Consumption Forecast — 90 days",
      subtitle: `Portfolio forecast ${fmtMwh(portfolio.forecastMwh)} · ${clients.length} clients`,
      filename: `forecast_90d_${stamp}`,
      sections: [{ heading: "Forecast vs Actual vs Budget", columns: cols, rows, totals }],
    });
  };

  // Visible date window inside the grid (first 14 days for editing; rest summarised)
  const visibleDates = horizonDates.slice(0, 14);

  return (
    <ErpLayout
      title="Forecasting & Budgeting"
      subtitle="90-day consumption forecasts, seasonal auto-generation, variance tracking"
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={clients.length === 0}>
                <Download className="h-3 w-3 mr-1" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportGrid("xlsx")}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportGrid("pdf")}><FileText className="h-4 w-4 mr-2" />PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <RoleGate roles={["management", "trader", "supply_manager", "admin"]}>
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Portfolio forecast (90d)" value={fmtMwh(portfolio.forecastMwh)} icon={TrendingUp} accent="primary" hint={fmtEur(portfolio.forecastEur)} />
            <StatCard label="Budget (90d)" value={portfolio.budgetMwh > 0 ? fmtMwh(portfolio.budgetMwh) : "—"} icon={Target} accent="accent" hint={portfolio.budgetEur > 0 ? fmtEur(portfolio.budgetEur) : "Set budgets inline"} />
            <StatCard label="Forecast accuracy (30d)" value={accuracy.mape != null ? `${accuracy.mape.toFixed(1)}% MAPE` : "—"} icon={Gauge} accent={accuracy.mape != null && accuracy.mape < 15 ? "primary" : "warning"} hint={`${accuracy.pairs.length} comparisons`} />
            <StatCard label="Out of tolerance" value={String(outOfTolerance.length)} icon={AlertTriangle} accent={outOfTolerance.length > 0 ? "destructive" : "accent"} hint={`>${(VARIANCE_TOLERANCE * 100).toFixed(0)}% variance`} />
          </div>

          {/* Controls */}
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Forecast controls</CardTitle>
                <CardDescription>Generate forecasts from prior-year consumption with an optional growth factor</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Horizon start</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Apply to</Label>
                <Select value={selectedClientId || "all"} onValueChange={setSelectedClientId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clients</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Growth (%)</Label>
                <Input type="number" step="0.1" value={growth} onChange={e => setGrowth(Number(e.target.value))} />
              </div>
              <div className="flex items-end">
                <Button onClick={() => generateSeasonal(selectedClientId || "all")} style={{ background: "var(--gradient-primary)" }} className="w-full">
                  <Sparkles className="h-4 w-4 mr-2" /> Generate seasonal
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Chart */}
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Actual vs Forecast — {clientById.get(selectedClientId)?.company_name ?? "—"}</CardTitle>
                <CardDescription>30 days actual + 60 days forward projection</CardDescription>
              </div>
              <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Pick a client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="h-80">
              {chartData.length === 0 ? (
                <div className="h-full grid place-items-center text-sm text-muted-foreground">Pick a client.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Legend />
                    <Bar dataKey="actual" fill="hsl(var(--primary))" name="Actual (MWh)" />
                    <Line type="monotone" dataKey="forecast" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="Forecast (MWh)" />
                    <Line type="monotone" dataKey="budget" stroke="hsl(var(--warning))" strokeDasharray="4 4" strokeWidth={2} dot={false} name="Budget (MWh)" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Variance alerts */}
          {variance.length > 0 && (
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Variance monitor</CardTitle>
                <CardDescription>Elapsed days in the current horizon — flagged if |actual − forecast| / forecast exceeds {(VARIANCE_TOLERANCE * 100).toFixed(0)}%</CardDescription>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Forecast (MWh)</TableHead>
                    <TableHead className="text-right">Actual (MWh)</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {variance.slice(0, 20).map(v => {
                      const flag = Math.abs(v.variance) > VARIANCE_TOLERANCE;
                      return (
                        <TableRow key={v.client_id}>
                          <TableCell className="font-medium">{v.company_name}</TableCell>
                          <TableCell className="text-right">{fmtNum(v.forecast, 2)}</TableCell>
                          <TableCell className="text-right">{fmtNum(v.actual, 2)}</TableCell>
                          <TableCell className={`text-right font-mono ${v.variance > 0 ? "text-destructive" : "text-primary"}`}>
                            {v.variance >= 0 ? "+" : ""}{(v.variance * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            <Badge className={flag ? "bg-destructive/20 text-destructive border-destructive/30" : "bg-accent/20 text-accent border-accent/30"}>
                              {flag ? "Out of tolerance" : "OK"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{v.daysElapsed}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Editable grid — next 14 days */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Daily forecast grid — next 14 days</CardTitle>
              <CardDescription>Click a cell to edit. Press Enter to save.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="sticky left-0 bg-card">Client</TableHead>
                  {visibleDates.map(d => (
                    <TableHead key={d} className="text-right text-xs whitespace-nowrap">{format(new Date(d), "MM-dd")}</TableHead>
                  ))}
                  <TableHead className="text-right text-xs">14d total</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {clients.map(c => {
                    let total = 0;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="sticky left-0 bg-card font-medium text-sm">{c.company_name}</TableCell>
                        {visibleDates.map(d => {
                          const k = `${c.id}|${d}`;
                          const f = forecastByKey.get(k);
                          const val = editing[k] ?? (f ? Number(f.forecast_mwh) : 0);
                          total += val;
                          const isSaving = savingKey === k;
                          return (
                            <TableCell key={d} className="p-1">
                              <Input
                                type="number" step="0.01"
                                value={editing[k] ?? (f ? Number(f.forecast_mwh) : "")}
                                onChange={e => setEditing(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                                onBlur={e => { if (editing[k] != null && editing[k] !== (f ? Number(f.forecast_mwh) : 0)) saveCell(c.id, d, Number(e.target.value)); }}
                                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                disabled={isSaving}
                                className="h-7 text-xs text-right font-mono w-20"
                                placeholder="—"
                              />
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right font-mono text-xs">{fmtNum(total, 1)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {clients.length === 0 && (
                    <TableRow><TableCell colSpan={visibleDates.length + 2} className="text-center text-sm text-muted-foreground py-10">No clients yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </RoleGate>
    </ErpLayout>
  );
}