import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/erp/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Target, Play, TrendingUp } from "lucide-react";

/**
 * Forecast accuracy (MAPE) — measures the volume_forecasts snapshots against
 * what the month actually turned out to be. MAPE = mean |error| %, bias =
 * mean signed error % (systematic over/under-forecasting). Only meaningful
 * for months with (mostly) complete data. Realized volume prefers official
 * DSO readings per client, falling back to internal.
 */
export default function ForecastAccuracy() {
  const [month, setMonth] = useState(() => {
    const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  });
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ clientId: string; name: string; category: string | null; forecast: number; realized: number; errPct: number; snapshots: number }[]>([]);
  const [evolution, setEvolution] = useState<{ label: string; forecast: number }[]>([]);
  const [evoClient, setEvoClient] = useState<string>("");
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    supabase.from("clients").select("id, company_name").then(({ data }) => {
      setNames(new Map(((data ?? []) as any[]).map(c => [c.id, c.company_name])));
    });
  }, []);

  async function compute() {
    setBusy(true);
    try {
      const monthISO = `${month}-01`;
      const [y, m] = month.split("-").map(Number);
      const start = `${month}-01T00:00:00Z`;
      const end = new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString();

      const [{ data: snaps }, { data: cps }, { data: iv }] = await Promise.all([
        (supabase.from as any)("volume_forecasts").select("client_id, slp_category, forecast_mwh, created_at").eq("scope", "client").eq("month", monthISO).order("created_at"),
        (supabase.from as any)("connection_points").select("metering_point_id, customer_id").eq("status", "active"),
        supabase.from("consumption_readings").select("metering_point_id, actual_mwh, source, quality").gte("reading_at", start).lte("reading_at", end).limit(200000),
      ]);
      if (!snaps?.length) { toast({ title: "No snapshots for this month", description: "forecast-volumes hasn't run for it.", variant: "destructive" }); setRows([]); return; }

      const clientOf = new Map<string, string>();
      ((cps ?? []) as any[]).forEach(c => { if (c.metering_point_id && c.customer_id) clientOf.set(c.metering_point_id, c.customer_id); });

      // Realized per client — official first, internal fallback
      const off = new Map<string, number>(); const int_ = new Map<string, number>();
      for (const r of ((iv ?? []) as any[])) {
        if ((r.quality ?? "measured") === "flagged") continue;
        const cid = clientOf.get(r.metering_point_id); if (!cid) continue;
        const isOff = r.source === "DSO_INTERVAL" || r.source === "DSO_MONTHLY";
        const t = isOff ? off : int_;
        t.set(cid, (t.get(cid) ?? 0) + Number(r.actual_mwh || 0));
      }

      // Per client: use the LAST snapshot of the month (what we ended up believing);
      // count how many snapshots existed (evolution depth)
      const lastSnap = new Map<string, { fc: number; cat: string | null; n: number }>();
      for (const s of (snaps as any[])) {
        const prev = lastSnap.get(s.client_id);
        lastSnap.set(s.client_id, { fc: Number(s.forecast_mwh), cat: s.slp_category, n: (prev?.n ?? 0) + 1 });
      }

      const out: typeof rows = [];
      for (const [cid, s] of lastSnap) {
        const realized = off.get(cid) ?? int_.get(cid);
        if (!realized || realized <= 0) continue;
        out.push({
          clientId: cid, name: names.get(cid) ?? cid.slice(0, 8), category: s.cat,
          forecast: +s.fc.toFixed(3), realized: +realized.toFixed(3),
          errPct: +(((s.fc - realized) / realized) * 100).toFixed(1), snapshots: s.n,
        });
      }
      out.sort((a, b) => Math.abs(b.errPct) - Math.abs(a.errPct));
      setRows(out);
      if (out.length && !evoClient) setEvoClient(out[0].clientId);
      toast({ title: "Accuracy computed", description: `${out.length} clients with forecast + realized data` });
    } finally { setBusy(false); }
  }

  // Forecast evolution for one client: every snapshot through the month vs realized
  useEffect(() => {
    (async () => {
      if (!evoClient) { setEvolution([]); return; }
      const monthISO = `${month}-01`;
      const { data } = await (supabase.from as any)("volume_forecasts")
        .select("forecast_mwh, created_at").eq("scope", "client").eq("client_id", evoClient).eq("month", monthISO).order("created_at");
      setEvolution(((data ?? []) as any[]).map(d => ({ label: new Date(d.created_at).toISOString().slice(5, 10), forecast: +Number(d.forecast_mwh).toFixed(3) })));
    })();
  }, [evoClient, month, rows]);

  const summary = useMemo(() => {
    if (!rows.length) return { mape: 0, bias: 0 };
    const mape = rows.reduce((s, r) => s + Math.abs(r.errPct), 0) / rows.length;
    const bias = rows.reduce((s, r) => s + r.errPct, 0) / rows.length;
    return { mape, bias };
  }, [rows]);

  const realizedForEvo = rows.find(r => r.clientId === evoClient)?.realized;

  return (
    <ErpLayout title="Forecast Accuracy" subtitle="MAPE & bias from volume-forecast snapshots vs realized months"
      actions={<Button size="sm" onClick={compute} disabled={busy}><Play className="h-4 w-4 mr-1" />{busy ? "Computing…" : "Compute"}</Button>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Clients scored" value={String(rows.length)} icon={Target} />
        <StatCard label="MAPE" value={`${summary.mape.toFixed(1)}%`} icon={Target} accent={summary.mape > 10 ? "warning" : "primary"} />
        <StatCard label="Bias" value={`${summary.bias >= 0 ? "+" : ""}${summary.bias.toFixed(1)}%`} icon={TrendingUp} accent={Math.abs(summary.bias) > 3 ? "warning" : "primary"} />
        <div className="rounded-md border border-border/60 px-3 py-2">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Month</Label>
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Per-client accuracy</CardTitle>
          <CardDescription>Error = (last forecast − realized) / realized. Positive bias = systematic over-forecasting (buying too much); negative = under (paying up-regulation).</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>SLP category</TableHead>
              <TableHead className="text-right">Forecast MWh</TableHead>
              <TableHead className="text-right">Realized MWh</TableHead>
              <TableHead className="text-right">Error %</TableHead>
              <TableHead className="text-right">Snapshots</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.clientId} className="cursor-pointer" onClick={() => setEvoClient(r.clientId)}>
                  <TableCell className={evoClient === r.clientId ? "font-semibold" : ""}>{r.name}</TableCell>
                  <TableCell>{r.category ? <Badge variant="secondary">{r.category.replace(/_/g, " ")}</Badge> : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.forecast.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.realized.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums"><Badge variant={Math.abs(r.errPct) > 10 ? "destructive" : "outline"}>{r.errPct > 0 ? "+" : ""}{r.errPct}%</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.snapshots}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">Pick a completed month and press Compute.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {evolution.length > 0 && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Forecast evolution — {names.get(evoClient) ?? ""}</CardTitle>
            <CardDescription>How the projection moved through the month (each point = one snapshot). Line should converge to realized.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <LineChart data={evolution}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                {realizedForEvo !== undefined && <ReferenceLine y={realizedForEvo} stroke="hsl(var(--destructive))" strokeDasharray="5 4" label={{ value: `realized ${realizedForEvo.toFixed(2)}`, fontSize: 10 }} />}
                <Line dataKey="forecast" name="Forecast MWh" stroke="hsl(var(--primary))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </ErpLayout>
  );
}
