import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/erp/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Battery, Play, Save, Euro, RotateCw, AlertTriangle } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";

/**
 * BESS arbitrage optimizer. The battery earns money only when the spread over a
 * cycle beats the wear it causes, so degradation cost is a hard input, not a
 * decoration: without it the LP would happily cycle the pack to death for €2.
 */
type Asset = {
  id: string; asset_code: string; asset_type: string;
  nameplate_power_kw: number | null; usable_energy_kwh: number | null; nameplate_energy_kwh: number | null;
  charge_efficiency: number | null; discharge_efficiency: number | null;
  soc_min_pct: number | null; soc_max_pct: number | null; soc_terminal_pct: number | null;
  degradation_eur_per_mwh: number | null; max_cycles_per_day: number | null;
  grid_import_limit_kw: number | null; grid_export_limit_kw: number | null;
};
type PlanRow = { ts: string; setpointKw: number; priceEurMwh: number; socPct: number };
type RunResult = {
  run_id: string | null; start_soc_pct: number; start_soc_at: string | null;
  gross_revenue_eur: number; charge_cost_eur: number; degradation_eur: number; net_eur: number;
  cycles_used: number; binding_constraint: string; dispatch_rows_written: number; plan: PlanRow[];
  horizon: { start: string; end: string; periods: number };
};

const NUM = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export default function BessOptimizer() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [form, setForm] = useState<Partial<Asset>>({});
  const [horizon, setHorizon] = useState(24);
  const [backtest, setBacktest] = useState(false);
  const [startSoc, setStartSoc] = useState(50);
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);

  const asset = useMemo(() => assets.find(a => a.id === assetId) ?? null, [assets, assetId]);

  async function loadAssets() {
    const { data } = await (supabase.from as any)("assets")
      .select("id, asset_code, asset_type, nameplate_power_kw, usable_energy_kwh, nameplate_energy_kwh, charge_efficiency, discharge_efficiency, soc_min_pct, soc_max_pct, soc_terminal_pct, degradation_eur_per_mwh, max_cycles_per_day, grid_import_limit_kw, grid_export_limit_kw")
      .in("asset_type", ["bess", "hybrid"]).order("asset_code");
    const list = (data ?? []) as Asset[];
    setAssets(list);
    if (!assetId && list[0]) setAssetId(list[0].id);
  }
  useEffect(() => { loadAssets(); }, []);
  useEffect(() => { if (asset) setForm(asset); }, [asset]);

  useEffect(() => {
    if (!assetId) return;
    (supabase.from as any)("bess_optimizer_runs")
      .select("id, created_at, periods, net_value_eur, expected_revenue_eur, degradation_cost_eur, cycles_used, binding_constraint, backtest")
      .eq("asset_id", assetId).order("created_at", { ascending: false }).limit(10)
      .then(({ data }: any) => setRuns(data ?? []));
  }, [assetId, result]);

  async function saveParams() {
    if (!assetId) return;
    setSaving(true);
    const patch = {
      usable_energy_kwh: NUM(form.usable_energy_kwh), charge_efficiency: NUM(form.charge_efficiency),
      discharge_efficiency: NUM(form.discharge_efficiency), soc_min_pct: NUM(form.soc_min_pct),
      soc_max_pct: NUM(form.soc_max_pct), soc_terminal_pct: NUM(form.soc_terminal_pct),
      degradation_eur_per_mwh: NUM(form.degradation_eur_per_mwh), max_cycles_per_day: NUM(form.max_cycles_per_day),
      grid_import_limit_kw: NUM(form.grid_import_limit_kw), grid_export_limit_kw: NUM(form.grid_export_limit_kw),
    };
    const { error: e } = await (supabase.from as any)("assets").update(patch).eq("id", assetId);
    setSaving(false);
    if (e) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); return; }
    toast({ title: "Battery parameters saved" });
    loadAssets();
  }

  async function run() {
    if (!assetId) return;
    setRunning(true); setError(null);
    const { data, error: e } = await supabase.functions.invoke("optimize-bess", {
      body: { asset_id: assetId, horizon_hours: horizon, backtest, dry_run: dryRun, start_soc_pct: backtest ? startSoc : undefined },
    });
    setRunning(false);
    const res = data as any;
    if (e || !res?.ok) {
      const msg = res?.error ?? e?.message ?? "Optimizer failed";
      setError(msg); setResult(null);
      toast({ title: "No plan produced", description: msg, variant: "destructive" });
      return;
    }
    setResult(res as RunResult);
    toast({
      title: `Net ${Number(res.net_eur).toFixed(2)} € over ${res.horizon.periods} h`,
      description: `${res.cycles_used.toFixed(2)} cycles · binding: ${res.binding_constraint} · ${res.dispatch_rows_written} dispatch rows`,
    });
  }

  const chart = useMemo(() => (result?.plan ?? []).map(p => ({
    t: new Date(p.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    charge: p.setpointKw < 0 ? +Math.abs(p.setpointKw).toFixed(1) : 0,
    discharge: p.setpointKw > 0 ? +p.setpointKw.toFixed(1) : 0,
    price: +p.priceEurMwh.toFixed(2), soc: +p.socPct.toFixed(1),
  })), [result]);

  const P = ({ k, label, step = "any" }: { k: keyof Asset; label: string; step?: string }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" step={step} value={(form as any)[k] ?? ""} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
    </div>
  );

  return (
    <ErpLayout title="BESS Optimizer" subtitle="Price-driven battery dispatch with degradation cost and cycle limits">
      <div className="space-y-6">
        <Card className="border-border/60">
          <CardHeader className="flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Battery</CardTitle>
              <CardDescription>Economics are only as good as these numbers. Degradation is required — no value, no plan.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Select battery" /></SelectTrigger>
                <SelectContent>{assets.map(a => <SelectItem key={a.id} value={a.id}>{a.asset_code}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={saveParams} disabled={!assetId || saving}><Save className="h-4 w-4 mr-1" />Save</Button>
            </div>
          </CardHeader>
          <CardContent>
            {!assets.length ? (
              <p className="text-sm text-muted-foreground">No BESS or hybrid assets yet — add one under Sites & Assets first.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-5">
                <P k="usable_energy_kwh" label="Usable energy (kWh)" />
                <P k="charge_efficiency" label="Charge efficiency (0-1)" step="0.001" />
                <P k="discharge_efficiency" label="Discharge efficiency (0-1)" step="0.001" />
                <P k="soc_min_pct" label="SoC min (%)" />
                <P k="soc_max_pct" label="SoC max (%)" />
                <P k="soc_terminal_pct" label="Terminal SoC (%)" />
                <P k="degradation_eur_per_mwh" label="Degradation (€/MWh throughput)" />
                <P k="max_cycles_per_day" label="Max cycles / day" step="0.1" />
                <P k="grid_import_limit_kw" label="Grid import limit (kW)" />
                <P k="grid_export_limit_kw" label="Grid export limit (kW)" />
                <div className="md:col-span-5 text-xs text-muted-foreground">
                  Rule of thumb for degradation: capex € ÷ (usable MWh × warranty cycles × 2). Power rating comes from the asset's nameplate
                  ({asset?.nameplate_power_kw ?? "—"} kW).
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader><CardTitle>Run</CardTitle><CardDescription>Uses live market prices and fresh SoC telemetry. Missing either, it refuses rather than guessing.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Horizon (hours)</Label>
              <Input className="w-28" type="number" min={1} max={48} value={horizon} onChange={e => setHorizon(+e.target.value)} /></div>
            <div className="flex items-center gap-2"><Switch checked={backtest} onCheckedChange={setBacktest} /><Label className="text-sm">Backtest</Label></div>
            {backtest && (
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Assumed start SoC (%)</Label>
                <Input className="w-28" type="number" value={startSoc} onChange={e => setStartSoc(+e.target.value)} /></div>
            )}
            <div className="flex items-center gap-2"><Switch checked={dryRun} onCheckedChange={setDryRun} /><Label className="text-sm">Dry run (don't write dispatch)</Label></div>
            <Button onClick={run} disabled={!assetId || running}>
              {running ? <RotateCw className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}Optimize
            </Button>
            {error && (
              <div className="w-full flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {result && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard title="Net value" value={`€ ${result.net_eur.toFixed(2)}`} icon={Euro} description={`Revenue € ${result.gross_revenue_eur.toFixed(2)} − charge € ${result.charge_cost_eur.toFixed(2)}`} />
              <StatCard title="Degradation cost" value={`€ ${result.degradation_eur.toFixed(2)}`} icon={Battery} description="Wear priced into every MWh of throughput" />
              <StatCard title="Cycles used" value={result.cycles_used.toFixed(2)} icon={RotateCw} description={`Start SoC ${result.start_soc_pct.toFixed(0)}%${result.start_soc_at ? ` @ ${new Date(result.start_soc_at).toLocaleTimeString()}` : ""}`} />
              <StatCard title="Dispatch rows" value={String(result.dispatch_rows_written)} icon={Play} description={result.dispatch_rows_written ? "Written as planned arbitrage" : "Dry run / backtest — nothing written"} />
            </div>

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Plan</CardTitle>
                <CardDescription>
                  Binding constraint: <Badge variant="secondary">{result.binding_constraint}</Badge> — this is what stops the battery earning more.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="kw" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                    <ReferenceLine yAxisId="kw" y={0} stroke="hsl(var(--border))" />
                    <Bar yAxisId="kw" dataKey="charge" name="Charge kW" fill="hsl(var(--chart-2, var(--primary)))" />
                    <Bar yAxisId="kw" dataKey="discharge" name="Discharge kW" fill="hsl(var(--primary))" />
                    <Line yAxisId="p" dataKey="price" name="€/MWh" stroke="hsl(var(--destructive))" dot={false} />
                    <Line yAxisId="p" dataKey="soc" name="SoC %" stroke="hsl(var(--muted-foreground))" dot={false} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader><CardTitle>Hourly setpoints</CardTitle><CardDescription>Positive = discharge to grid, negative = charge.</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto max-h-96">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Hour</TableHead><TableHead className="text-right">€/MWh</TableHead>
                    <TableHead className="text-right">Setpoint kW</TableHead><TableHead className="text-right">SoC %</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {result.plan.map(p => (
                      <TableRow key={p.ts}>
                        <TableCell>{new Date(p.ts).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.priceEurMwh.toFixed(2)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${p.setpointKw > 0 ? "text-primary" : p.setpointKw < 0 ? "text-destructive" : ""}`}>{p.setpointKw.toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.socPct.toFixed(0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}

        <Card className="border-border/60">
          <CardHeader><CardTitle>Recent runs</CardTitle><CardDescription>Every run keeps its inputs and its binding constraint, so a dispatch decision can be explained later.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Periods</TableHead>
                <TableHead className="text-right">Net €</TableHead><TableHead className="text-right">Degradation €</TableHead>
                <TableHead className="text-right">Cycles</TableHead><TableHead>Binding</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {!runs.length && <TableRow><TableCell colSpan={7} className="text-muted-foreground">No runs yet.</TableCell></TableRow>}
                {runs.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell>{r.backtest ? <Badge variant="secondary">backtest</Badge> : <Badge>live</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.periods}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(r.net_value_eur ?? 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(r.degradation_cost_eur ?? 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(r.cycles_used ?? 0).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.binding_constraint}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ErpLayout>
  );
}
