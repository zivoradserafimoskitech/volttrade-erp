import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/erp/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sun, RefreshCw, AlertTriangle, Activity, Bell, CheckCircle2 } from "lucide-react";
import { format, formatDistanceToNow, subHours } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

type Asset = { id: string; asset_code: string; asset_type: string; nameplate_power_kw: number | null; pv_dc_kwp: number | null; site_id: string | null };
type Site = { id: string; name: string };
type Latest = { asset_id: string; ts: string; power_kw: number | null; pv_generation_kwh: number | null; status: string | null; alarm_code: string | null };
type Telemetry = { ts: string; power_kw: number | null; pv_generation_kwh: number | null };

const STALE_MIN_DEFAULT = 15;
const UNDERPERF_DEFAULT = 50; // %

export default function PvMonitoring() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [latest, setLatest] = useState<Latest[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [telemetry, setTelemetry] = useState<Telemetry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [staleMin, setStaleMin] = useState<number>(() => Number(localStorage.getItem("pvmon.stale") ?? STALE_MIN_DEFAULT));
  const [underperfPct, setUnderperfPct] = useState<number>(() => Number(localStorage.getItem("pvmon.underperf") ?? UNDERPERF_DEFAULT));

  useEffect(() => { localStorage.setItem("pvmon.stale", String(staleMin)); }, [staleMin]);
  useEffect(() => { localStorage.setItem("pvmon.underperf", String(underperfPct)); }, [underperfPct]);

  async function loadBase() {
    setLoading(true);
    const [a, s, l] = await Promise.all([
      supabase.from("assets").select("*").in("asset_type", ["pv", "hybrid"]).order("asset_code"),
      supabase.from("sites").select("id, name"),
      supabase.from("asset_telemetry_latest").select("*"),
    ]);
    const list = ((a.data ?? []) as any[]) as Asset[];
    // Standalone = no consumer EDU link (we treat assets registered via /assets as standalone plants)
    setAssets(list);
    setSites(((s.data ?? []) as any[]) as Site[]);
    setLatest(((l.data ?? []) as any[]) as Latest[]);
    if (!selectedId && list.length) setSelectedId(list[0].id);
    setLoading(false);
  }

  async function loadTelemetry(assetId: string) {
    if (!assetId) return;
    const from = subHours(new Date(), 24).toISOString();
    const { data } = await supabase
      .from("asset_telemetry")
      .select("ts, power_kw, pv_generation_kwh")
      .eq("asset_id", assetId)
      .gte("ts", from)
      .order("ts", { ascending: true });
    setTelemetry(((data ?? []) as any[]) as Telemetry[]);
  }

  useEffect(() => { loadBase(); }, []);
  useEffect(() => { if (selectedId) loadTelemetry(selectedId); }, [selectedId]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { loadBase(); if (selectedId) loadTelemetry(selectedId); }, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, selectedId]);

  const siteName = (id: string | null) => sites.find(s => s.id === id)?.name ?? "—";
  const latestFor = (id: string) => latest.find(l => l.asset_id === id);

  // Clear-sky expected kW now (very rough sine model)
  function expectedKwNow(asset: Asset): number {
    const kwp = asset.pv_dc_kwp ?? asset.nameplate_power_kw ?? 0;
    if (!kwp) return 0;
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const x = (h - 6) / 12; // 6..18 -> 0..1
    if (x <= 0 || x >= 1) return 0;
    const factor = Math.sin(Math.PI * x); // peak at noon
    const seasonal = 0.65 + 0.35 * Math.sin((new Date().getMonth() - 2) / 12 * 2 * Math.PI);
    return kwp * factor * seasonal * 0.85; // PR
  }

  type Row = { asset: Asset; lt: Latest | undefined; ageMin: number | null; expectedKw: number; actualKw: number; alerts: string[] };
  const rows: Row[] = useMemo(() => assets.map(asset => {
    const lt = latestFor(asset.id);
    const ageMin = lt?.ts ? Math.round((Date.now() - new Date(lt.ts).getTime()) / 60000) : null;
    const expectedKw = expectedKwNow(asset);
    const actualKw = Number(lt?.power_kw ?? 0);
    const alerts: string[] = [];
    if (ageMin === null) alerts.push("No telemetry");
    else if (ageMin > staleMin) alerts.push(`Stale (${ageMin}m)`);
    if (lt?.alarm_code) alerts.push(`Alarm: ${lt.alarm_code}`);
    if (expectedKw > 1 && actualKw / expectedKw * 100 < underperfPct) alerts.push("Underperforming");
    if (lt?.status && !["ok", "running", "online"].includes(lt.status.toLowerCase())) alerts.push(`Status: ${lt.status}`);
    return { asset, lt, ageMin, expectedKw, actualKw, alerts };
  }), [assets, latest, staleMin, underperfPct]);

  const totals = useMemo(() => {
    const onl = rows.filter(r => r.ageMin !== null && r.ageMin <= staleMin).length;
    const alarms = rows.reduce((acc, r) => acc + r.alerts.length, 0);
    const kwSum = rows.reduce((acc, r) => acc + r.actualKw, 0);
    const kwpSum = rows.reduce((acc, r) => acc + (r.asset.pv_dc_kwp ?? r.asset.nameplate_power_kw ?? 0), 0);
    return { onl, alarms, kwSum, kwpSum };
  }, [rows, staleMin]);

  const flagged = rows.filter(r => r.alerts.length > 0);

  const selected = assets.find(a => a.id === selectedId);
  const chartData = telemetry.map(t => ({ time: format(new Date(t.ts), "HH:mm"), kw: Number(t.power_kw ?? 0), kwh: Number(t.pv_generation_kwh ?? 0) }));

  return (
    <ErpLayout title="PV Plant Monitoring" subtitle="Live status, last telemetry, and alerts for standalone PV assets" actions={
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-emerald-500" /><Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} /><span>Auto-refresh</span></div>
        <Button variant="outline" size="sm" onClick={() => { loadBase(); if (selectedId) loadTelemetry(selectedId); toast.success("Refreshed"); }} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>
    }>
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Plants online" value={`${totals.onl}/${rows.length}`} icon={CheckCircle2} />
          <StatCard label="Active alerts" value={String(totals.alarms)} icon={Bell} />
          <StatCard label="Live output" value={`${totals.kwSum.toFixed(1)} kW`} icon={Sun} />
          <StatCard label="Installed (DC)" value={`${totals.kwpSum.toFixed(0)} kWp`} icon={Sun} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" />Alert thresholds</CardTitle>
            <CardDescription>Tune what counts as an alert. Saved locally.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 max-w-2xl">
            <div className="space-y-1">
              <Label>Telemetry stale after (minutes)</Label>
              <Input type="number" min={1} value={staleMin} onChange={e => setStaleMin(Number(e.target.value) || STALE_MIN_DEFAULT)} />
            </div>
            <div className="space-y-1">
              <Label>Underperformance threshold (% of expected)</Label>
              <Input type="number" min={1} max={100} value={underperfPct} onChange={e => setUnderperfPct(Number(e.target.value) || UNDERPERF_DEFAULT)} />
            </div>
          </CardContent>
        </Card>

        {flagged.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{flagged.length} plant(s) need attention</AlertTitle>
            <AlertDescription>
              {flagged.slice(0, 3).map(r => `${r.asset.asset_code}: ${r.alerts.join(", ")}`).join(" • ")}
              {flagged.length > 3 ? ` • +${flagged.length - 3} more` : ""}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Plants</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-right">DC kWp</TableHead>
                  <TableHead className="text-right">Live kW</TableHead>
                  <TableHead className="text-right">Expected kW</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Alerts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No PV assets registered yet</TableCell></TableRow>}
                {rows.map(r => (
                  <TableRow key={r.asset.id} className={selectedId === r.asset.id ? "bg-muted/40 cursor-pointer" : "cursor-pointer"} onClick={() => setSelectedId(r.asset.id)}>
                    <TableCell className="font-medium">{r.asset.asset_code}</TableCell>
                    <TableCell>{siteName(r.asset.site_id)}</TableCell>
                    <TableCell className="text-right">{(r.asset.pv_dc_kwp ?? r.asset.nameplate_power_kw ?? 0).toFixed(0)}</TableCell>
                    <TableCell className="text-right">{r.actualKw.toFixed(1)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.expectedKw.toFixed(1)}</TableCell>
                    <TableCell className="text-xs">{r.lt?.ts ? `${formatDistanceToNow(new Date(r.lt.ts))} ago` : "—"}</TableCell>
                    <TableCell>
                      {r.ageMin === null ? <Badge variant="outline">No data</Badge>
                        : r.ageMin > staleMin ? <Badge variant="destructive">Stale</Badge>
                        : <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20">Online</Badge>}
                    </TableCell>
                    <TableCell>
                      {r.alerts.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : (
                        <div className="flex flex-wrap gap-1">{r.alerts.map((a, i) => <Badge key={i} variant="destructive" className="text-xs">{a}</Badge>)}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {selected && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Sun className="h-4 w-4 text-amber-500" />{selected.asset_code} — last 24h</CardTitle>
              <CardDescription>{siteName(selected.site_id)} · {(selected.pv_dc_kwp ?? selected.nameplate_power_kw ?? 0).toFixed(0)} kWp</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="kw" name="Power (kW)" stroke="hsl(var(--primary))" fill="hsl(var(--primary)/0.2)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </ErpLayout>
  );
}