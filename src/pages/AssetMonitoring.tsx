import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/erp/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { RefreshCw, Battery, Sun, Zap, AlertTriangle, Plus, Activity } from "lucide-react";
import { format, subHours, subDays } from "date-fns";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, AreaChart, Area } from "recharts";

type Asset = { id: string; asset_code: string; asset_type: "bess" | "pv" | "hybrid"; nameplate_power_kw: number | null; nameplate_energy_kwh: number | null; pv_dc_kwp: number | null; site_id: string };
type Site = { id: string; name: string };
type Latest = { asset_id: string; ts: string; power_kw: number | null; soc_pct: number | null; pv_generation_kwh: number | null; grid_kw: number | null; load_kw: number | null; status: string | null; alarm_code: string | null };
type Telemetry = { ts: string; power_kw: number | null; soc_pct: number | null; pv_generation_kwh: number | null; grid_kw: number | null; load_kw: number | null };
type Dispatch = { id: string; asset_id: string; ts_from: string; ts_to: string; setpoint_kw: number; mode: string; status: string; notes: string | null };

const WINDOWS = { "6h": 6, "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };

export default function AssetMonitoring() {
  const { user } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [latest, setLatest] = useState<Latest[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [windowKey, setWindowKey] = useState<keyof typeof WINDOWS>("24h");
  const [telemetry, setTelemetry] = useState<Telemetry[]>([]);
  const [dispatch, setDispatch] = useState<Dispatch[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchForm, setDispatchForm] = useState<any>({ ts_from: format(new Date(), "yyyy-MM-dd'T'HH:00"), ts_to: format(new Date(Date.now() + 3600_000), "yyyy-MM-dd'T'HH:00"), setpoint_kw: 0, mode: "manual", notes: "" });
  const [showForecast, setShowForecast] = useState(true);

  async function loadBase() {
    const [a, s, l] = await Promise.all([
      supabase.from("assets").select("*").order("asset_code"),
      supabase.from("sites").select("id, name"),
      supabase.from("asset_telemetry_latest").select("*"),
    ]);
    const list = (a.data ?? []) as any as Asset[];
    setAssets(list);
    setSites((s.data ?? []) as any);
    setLatest((l.data ?? []) as any);
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
  }

  async function loadSeries(assetId: string) {
    if (!assetId) return;
    const hours = WINDOWS[windowKey];
    const from = subHours(new Date(), hours).toISOString();
    const [t, d] = await Promise.all([
      supabase.from("asset_telemetry").select("ts, power_kw, soc_pct, pv_generation_kwh, grid_kw, load_kw")
        .eq("asset_id", assetId).gte("ts", from).order("ts"),
      supabase.from("asset_dispatch_schedules").select("*").eq("asset_id", assetId)
        .gte("ts_from", subDays(new Date(), 1).toISOString()).order("ts_from"),
    ]);
    setTelemetry((t.data ?? []) as any);
    setDispatch((d.data ?? []) as any);
  }

  useEffect(() => { if (user) loadBase(); }, [user]);
  useEffect(() => { if (selectedId) loadSeries(selectedId); }, [selectedId, windowKey]);

  // Realtime: refresh latest snapshot on changes
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("asset_latest")
      .on("postgres_changes", { event: "*", schema: "public", table: "asset_telemetry_latest" }, () => {
        supabase.from("asset_telemetry_latest").select("*").then(({ data }) => setLatest((data ?? []) as any));
        if (selectedId) loadSeries(selectedId);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, selectedId]);

  async function sync() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-asset-telemetry", { body: { window_minutes: 60 } });
      if (error) throw error;
      if (data?.ok) toast.success(`Synced ${data.synced} points across ${data.assets} assets`);
      else toast.error(data?.error || "Sync failed");
      await loadBase();
      if (selectedId) await loadSeries(selectedId);
    } catch (e: any) {
      toast.error(e.message || "Sync failed");
    } finally { setSyncing(false); }
  }

  async function saveDispatch() {
    if (!user || !selectedId) return;
    const { error } = await supabase.from("asset_dispatch_schedules").insert({
      user_id: user.id, asset_id: selectedId,
      ts_from: new Date(dispatchForm.ts_from).toISOString(),
      ts_to: new Date(dispatchForm.ts_to).toISOString(),
      setpoint_kw: Number(dispatchForm.setpoint_kw),
      mode: dispatchForm.mode, notes: dispatchForm.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Dispatch planned");
    setDispatchOpen(false);
    loadSeries(selectedId);
  }

  const selected = assets.find(a => a.id === selectedId);
  const selLatest = latest.find(l => l.asset_id === selectedId);
  const siteName = sites.find(s => s.id === selected?.site_id)?.name ?? "—";

  const totals = useMemo(() => {
    const liveAssets = latest.length;
    const pvKw = latest.reduce((s, l) => s + (Number(l.pv_generation_kwh) || 0), 0); // sum over interval
    const charging = latest.filter(l => (l.power_kw ?? 0) < 0).length;
    const discharging = latest.filter(l => (l.power_kw ?? 0) > 0).length;
    const alarms = latest.filter(l => l.alarm_code).length;
    return { liveAssets, pvKw, charging, discharging, alarms };
  }, [latest]);

  // Simple clear-sky PV forecast: bell curve between sunrise/sunset scaled to nameplate kWp.
  // Returns kWh produced within `intervalMinutes` centered on `date`.
  function pvForecastKwh(date: Date, kWp: number, intervalMinutes: number, sunrise = 6, sunset = 20) {
    if (!kWp || kWp <= 0) return 0;
    const h = date.getHours() + date.getMinutes() / 60;
    if (h <= sunrise || h >= sunset) return 0;
    const x = (h - sunrise) / (sunset - sunrise); // 0..1
    const shape = Math.sin(Math.PI * x); // 0..1..0
    // Peak power ~ 80% of DC kWp under clear sky (rough heuristic)
    const peakKw = kWp * 0.8;
    const kW = peakKw * shape;
    return kW * (intervalMinutes / 60);
  }

  const intervalMin = useMemo(() => {
    if (telemetry.length < 2) return 1;
    const a = new Date(telemetry[0].ts).getTime();
    const b = new Date(telemetry[1].ts).getTime();
    return Math.max(1, Math.round((b - a) / 60000));
  }, [telemetry]);

  const kWp = selected?.pv_dc_kwp ?? selected?.nameplate_power_kw ?? 0;

  const chartData = telemetry.map(t => {
    const d = new Date(t.ts);
    return {
      t: format(d, windowKey === "6h" || windowKey === "24h" ? "HH:mm" : "MM-dd HH:mm"),
      power: t.power_kw ?? null, soc: t.soc_pct ?? null,
      pv: t.pv_generation_kwh ?? null, grid: t.grid_kw ?? null, load: t.load_kw ?? null,
      pv_forecast: kWp > 0 ? Number(pvForecastKwh(d, Number(kWp), intervalMin).toFixed(3)) : null,
    };
  });

  const pvDeviation = useMemo(() => {
    if (!showForecast || kWp <= 0) return null;
    let act = 0, fc = 0;
    for (const r of chartData) { act += Number(r.pv) || 0; fc += Number(r.pv_forecast) || 0; }
    if (fc === 0) return null;
    return { actual: act, forecast: fc, deltaPct: ((act - fc) / fc) * 100 };
  }, [chartData, showForecast, kWp]);

  const typeIcon = (t?: string) => t === "pv" ? <Sun className="h-4 w-4" /> : t === "hybrid" ? <Zap className="h-4 w-4" /> : <Battery className="h-4 w-4" />;

  return (
    <ErpLayout title="Asset Monitoring" subtitle="Live & historical telemetry for BESS and PV">
      <div className="grid gap-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Live assets" value={String(totals.liveAssets)} icon={Activity} />
          <StatCard label="Discharging" value={String(totals.discharging)} icon={Battery} />
          <StatCard label="Charging" value={String(totals.charging)} icon={Battery} />
          <StatCard label="PV gen (last interval)" value={`${totals.pvKw.toFixed(1)} kWh`} icon={Sun} />
          <StatCard label="Active alarms" value={String(totals.alarms)} icon={AlertTriangle} />
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">{typeIcon(selected?.asset_type)} {selected?.asset_code ?? "Select an asset"} <span className="text-sm text-muted-foreground font-normal">· {siteName}</span></CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Asset" /></SelectTrigger>
                <SelectContent>{assets.map(a => <SelectItem key={a.id} value={a.id}>{a.asset_code} ({a.asset_type})</SelectItem>)}</SelectContent>
              </Select>
              <Select value={windowKey} onValueChange={v => setWindowKey(v as any)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(WINDOWS).map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={sync} disabled={syncing}><RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />Sync</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {selLatest && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div><div className="text-muted-foreground text-xs">Power</div><div className="font-semibold">{selLatest.power_kw?.toFixed(2) ?? "—"} kW</div></div>
                <div><div className="text-muted-foreground text-xs">SoC</div><div className="font-semibold">{selLatest.soc_pct?.toFixed(1) ?? "—"} %</div></div>
                <div><div className="text-muted-foreground text-xs">Grid</div><div className="font-semibold">{selLatest.grid_kw?.toFixed(2) ?? "—"} kW</div></div>
                <div><div className="text-muted-foreground text-xs">Load</div><div className="font-semibold">{selLatest.load_kw?.toFixed(2) ?? "—"} kW</div></div>
                <div><div className="text-muted-foreground text-xs">Status</div><Badge variant={selLatest.alarm_code ? "destructive" : "default"}>{selLatest.alarm_code ?? selLatest.status ?? "ok"}</Badge></div>
              </div>
            )}

            <div>
              <div className="text-sm font-medium mb-2">Power flow (kW)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="power" stroke="hsl(var(--primary))" dot={false} name="Asset" />
                    <Line type="monotone" dataKey="grid" stroke="#f59e0b" dot={false} name="Grid" />
                    <Line type="monotone" dataKey="load" stroke="#ef4444" dot={false} name="Load" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {(selected?.asset_type === "bess" || selected?.asset_type === "hybrid") && (
              <div>
                <div className="text-sm font-medium mb-2">State of Charge (%)</div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="soc" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {(selected?.asset_type === "pv" || selected?.asset_type === "hybrid") && (
              <div>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="text-sm font-medium">PV generation (kWh / interval)</div>
                  <div className="flex items-center gap-3 text-xs">
                    {pvDeviation && (
                      <span className="text-muted-foreground">
                        Σ actual {pvDeviation.actual.toFixed(1)} kWh · forecast {pvDeviation.forecast.toFixed(1)} kWh ·{" "}
                        <span className={pvDeviation.deltaPct >= 0 ? "text-emerald-500" : "text-amber-500"}>
                          {pvDeviation.deltaPct >= 0 ? "+" : ""}{pvDeviation.deltaPct.toFixed(1)}%
                        </span>
                      </span>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch checked={showForecast} onCheckedChange={setShowForecast} />
                      <span>Forecast overlay</span>
                    </label>
                  </div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Area type="monotone" dataKey="pv" stroke="#f59e0b" fill="#f59e0b33" name="Actual" />
                      {showForecast && (
                        <Line type="monotone" dataKey="pv_forecast" stroke="hsl(var(--primary))" strokeDasharray="4 4" dot={false} name="Forecast (clear-sky)" />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Dispatch schedule</CardTitle>
            <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
              <DialogTrigger asChild><Button size="sm" disabled={!selectedId}><Plus className="h-4 w-4 mr-1" />Plan setpoint</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Plan dispatch</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>From</Label><Input type="datetime-local" value={dispatchForm.ts_from} onChange={e => setDispatchForm({ ...dispatchForm, ts_from: e.target.value })} /></div>
                    <div><Label>To</Label><Input type="datetime-local" value={dispatchForm.ts_to} onChange={e => setDispatchForm({ ...dispatchForm, ts_to: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Setpoint (kW, + discharge / - charge)</Label><Input type="number" value={dispatchForm.setpoint_kw} onChange={e => setDispatchForm({ ...dispatchForm, setpoint_kw: e.target.value })} /></div>
                    <div>
                      <Label>Mode</Label>
                      <Select value={dispatchForm.mode} onValueChange={v => setDispatchForm({ ...dispatchForm, mode: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">Manual</SelectItem>
                          <SelectItem value="peak_shave">Peak shave</SelectItem>
                          <SelectItem value="arbitrage">Arbitrage</SelectItem>
                          <SelectItem value="auto">Auto</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>Notes</Label><Input value={dispatchForm.notes} onChange={e => setDispatchForm({ ...dispatchForm, notes: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={saveDispatch}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead className="text-right">Setpoint kW</TableHead><TableHead>Mode</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
              <TableBody>
                {dispatch.map(d => (
                  <TableRow key={d.id}>
                    <TableCell>{format(new Date(d.ts_from), "MM-dd HH:mm")}</TableCell>
                    <TableCell>{format(new Date(d.ts_to), "MM-dd HH:mm")}</TableCell>
                    <TableCell className="text-right font-medium">{d.setpoint_kw.toFixed(1)}</TableCell>
                    <TableCell><Badge variant="outline">{d.mode}</Badge></TableCell>
                    <TableCell><Badge variant={d.status === "planned" ? "secondary" : "default"}>{d.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{d.notes ?? ""}</TableCell>
                  </TableRow>
                ))}
                {dispatch.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No planned dispatches</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ErpLayout>
  );
}