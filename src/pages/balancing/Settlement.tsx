import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/erp/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Scale, TrendingDown, Save } from "lucide-react";

type Seg = "PROFILED" | "MEASURED" | "PV";

export default function Settlement() {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [bg, setBg] = useState<string>("");
  const [dual, setDual] = useState(false);
  const [singlePrice, setSinglePrice] = useState(85);
  const [upPrice, setUpPrice] = useState(125);
  const [downPrice, setDownPrice] = useState(45);
  const [rows, setRows] = useState<{ segment: Seg; scheduled: number; actual: number }[]>([
    { segment: "PROFILED", scheduled: 720, actual: 718 },
    { segment: "MEASURED", scheduled: 360, actual: 384 },
    { segment: "PV", scheduled: 110, actual: 96 },
  ]);

  useEffect(() => { supabase.from("balance_groups").select("id,name").then(({ data }) => { setGroups(data ?? []); if (data?.[0]) setBg(data[0].id); }); }, []);

  const enriched = useMemo(() => rows.map(r => {
    const imb = r.actual - r.scheduled;
    const price = dual ? (imb >= 0 ? downPrice : upPrice) : singlePrice;
    return { ...r, imbalance: imb, price, cost: imb * price };
  }), [rows, dual, singlePrice, upPrice, downPrice]);

  const totals = enriched.reduce((s, r) => ({
    scheduled: s.scheduled + r.scheduled, actual: s.actual + r.actual,
    imbalance: s.imbalance + r.imbalance, cost: s.cost + r.cost,
  }), { scheduled: 0, actual: 0, imbalance: 0, cost: 0 });

  async function persist(status: "PROVISIONAL" | "FINAL") {
    const [y, m] = period.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const payload = enriched.map(r => ({
      balance_group_id: bg || null, period_start: start, period_end: end, segment: r.segment,
      scheduled_mwh: r.scheduled, actual_mwh: r.actual, imbalance_mwh: r.imbalance,
      imbalance_price: r.price, imbalance_price_up: dual ? upPrice : null, imbalance_price_down: dual ? downPrice : null,
      imbalance_cost: r.cost, status,
    }));
    const { error } = await supabase.from("settlements").insert(payload);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Settlement ${status}`, description: `${enriched.length} segments saved` });
  }

  return (
    <ErpLayout title="Imbalance Settlement" subtitle="Scheduled vs actual per segment · cost allocation to cost-to-serve"
      actions={<>
        <Button size="sm" variant="outline" onClick={() => persist("PROVISIONAL")}><Save className="h-4 w-4 mr-1" />Save provisional</Button>
        <Button size="sm" onClick={() => persist("FINAL")}><Save className="h-4 w-4 mr-1" />Mark final</Button>
      </>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Scheduled" value={`${totals.scheduled.toFixed(1)} MWh`} icon={Scale} />
        <StatCard label="Actual" value={`${totals.actual.toFixed(1)} MWh`} icon={Scale} accent="accent" />
        <StatCard label="Imbalance" value={`${totals.imbalance >= 0 ? "+" : ""}${totals.imbalance.toFixed(1)} MWh`} icon={TrendingDown} accent={Math.abs(totals.imbalance) > 20 ? "destructive" : "primary"} />
        <StatCard label="Imbalance cost" value={`€ ${totals.cost.toFixed(0)}`} icon={Scale} accent={totals.cost < 0 ? "primary" : "warning"} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Pricing & period</CardTitle>
          <CardDescription>Toggle single vs dual imbalance pricing</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Field label="Period (YYYY-MM)"><Input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></Field>
          <Field label="Balance group"><Select value={bg} onValueChange={setBg}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select></Field>
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 mt-5"><Label className="text-xs">Dual pricing</Label><Switch checked={dual} onCheckedChange={setDual} /></div>
          {!dual && <Field label="Single price (€/MWh)"><Input type="number" value={singlePrice} onChange={e => setSinglePrice(+e.target.value)} /></Field>}
          {dual && <>
            <Field label="Up regulation €/MWh"><Input type="number" value={upPrice} onChange={e => setUpPrice(+e.target.value)} /></Field>
            <Field label="Down regulation €/MWh"><Input type="number" value={downPrice} onChange={e => setDownPrice(+e.target.value)} /></Field>
          </>}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Per-segment settlement</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Segment</TableHead><TableHead className="text-right">Scheduled</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Imbalance</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
            <TableBody>
              {enriched.map((r, i) => (
                <TableRow key={r.segment}>
                  <TableCell><Badge variant="secondary">{r.segment}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums"><Input className="w-24 inline-block text-right" type="number" value={r.scheduled} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, scheduled: +e.target.value } : x))} /></TableCell>
                  <TableCell className="text-right tabular-nums"><Input className="w-24 inline-block text-right" type="number" value={r.actual} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, actual: +e.target.value } : x))} /></TableCell>
                  <TableCell className="text-right tabular-nums">{r.imbalance.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">€ {r.price.toFixed(0)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">€ {r.cost.toFixed(0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Cost by segment</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer>
            <BarChart data={enriched}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="segment" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="imbalance" name="Imbalance MWh" fill="hsl(var(--accent))" />
              <Bar dataKey="cost" name="Cost €" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>{children}</div>;
}