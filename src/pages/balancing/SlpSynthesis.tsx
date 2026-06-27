import { useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/erp/StatCard";
import { SLP_CATEGORIES, SlpCategory, synthesizeHourly, shape24h, seasonOf, dayTypeOf } from "@/lib/slpSynthesis";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Area, AreaChart } from "recharts";
import { Activity, BarChart3, Sigma } from "lucide-react";

export default function SlpSynthesis() {
  const [cat, setCat] = useState<SlpCategory>("Office");
  const [monthlyKwh, setMonthlyKwh] = useState(2400);
  const [periodStart, setPeriodStart] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [showFit, setShowFit] = useState(true);
  const [noisePct, setNoisePct] = useState(18);

  const data = useMemo(() => {
    const start = new Date(periodStart + "T00:00:00");
    const end = new Date(periodEnd + "T23:00:00");
    const series = synthesizeHourly(cat, monthlyKwh, start, end);
    // Simulated PRIVATE_SMART overlay = synthesis + random noise (for the Profile-Fit view)
    return series.map(p => {
      const rnd = (Math.sin(p.ts.getTime() / 1e7) + Math.cos(p.ts.getTime() / 3e7)) * (noisePct / 100);
      return {
        t: p.ts.toISOString().slice(5, 16).replace("T", " "),
        synth: +p.kwh.toFixed(3),
        private: +(p.kwh * (1 + rnd)).toFixed(3),
      };
    });
  }, [cat, monthlyKwh, periodStart, periodEnd, noisePct]);

  const totalSynth = data.reduce((s, d) => s + d.synth, 0);
  const totalPriv = data.reduce((s, d) => s + d.private, 0);
  const residual = totalPriv - totalSynth;
  const residualPct = totalSynth ? (residual / totalSynth) * 100 : 0;

  // 24h shape per season/day-type
  const shapesWD = shape24h(cat, seasonOf(new Date(periodStart)), "WD").map((v, h) => ({ h, WD: +(v * 100).toFixed(2) }));
  const shapesSA = shape24h(cat, seasonOf(new Date(periodStart)), "SA");
  const shapesSU = shape24h(cat, seasonOf(new Date(periodStart)), "SU");
  const shapes = shapesWD.map((r, i) => ({ ...r, SA: +(shapesSA[i] * 100).toFixed(2), SU: +(shapesSU[i] * 100).toFixed(2) }));

  // sample slice for the overlay chart (first 7 days = 168 pts) to stay readable
  const overlay = data.slice(0, 24 * 7);

  return (
    <ErpLayout title="SLP Synthesis Engine" subtitle="Allocate certified monthly kWh onto the DSO standard load profile shape">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <StatCard label="Synth total" value={`${totalSynth.toFixed(0)} kWh`} icon={Sigma} />
        <StatCard label="Private-meter total" value={`${totalPriv.toFixed(0)} kWh`} icon={Activity} accent="accent" />
        <StatCard label="Residual" value={`${residual >= 0 ? "+" : ""}${residual.toFixed(0)} kWh`} icon={BarChart3} accent={Math.abs(residualPct) > 10 ? "destructive" : "primary"} hint={`${residualPct.toFixed(1)}% vs synthesis`} />
        <StatCard label="Period hours" value={String(data.length)} icon={Activity} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Inputs</CardTitle>
          <CardDescription>Monthly certified kWh × period × SLP category</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Field label="SLP category"><Select value={cat} onValueChange={v => setCat(v as SlpCategory)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SLP_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select></Field>
          <Field label="Period start"><Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></Field>
          <Field label="Period end"><Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></Field>
          <Field label="Monthly certified kWh"><Input type="number" value={monthlyKwh} onChange={e => setMonthlyKwh(+e.target.value)} /></Field>
          <Field label="Sim noise (private)"><Input type="number" value={noisePct} onChange={e => setNoisePct(+e.target.value)} /></Field>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Hourly synthesis vs private meter</CardTitle>
            <CardDescription>First 7 days of the period · <Badge variant="outline" className="ml-1">Analytics only — not used for settlement</Badge></CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs"><Label>Profile-Fit overlay</Label><Switch checked={showFit} onCheckedChange={setShowFit} /></div>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer>
            <LineChart data={overlay}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend />
              <Line dataKey="synth" name="SLP synthesis (settlement)" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
              {showFit && <Line dataKey="private" name="Private smart meter (analytics)" stroke="hsl(var(--accent))" strokeDasharray="3 3" dot={false} strokeWidth={2} />}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Profile shape — {cat.replace(/_/g, " ")} · {seasonOf(new Date(periodStart))}</CardTitle>
          <CardDescription>Normalized hour-share (%) by day type</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer>
            <AreaChart data={shapes}>
              <defs>
                <linearGradient id="wdF" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="h" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
              <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend />
              <Area type="monotone" dataKey="WD" stroke="hsl(var(--primary))" fill="url(#wdF)" />
              <Line type="monotone" dataKey="SA" stroke="hsl(var(--accent))" dot={false} />
              <Line type="monotone" dataKey="SU" stroke="hsl(var(--warning))" dot={false} strokeDasharray="3 3" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>{children}</div>;
}