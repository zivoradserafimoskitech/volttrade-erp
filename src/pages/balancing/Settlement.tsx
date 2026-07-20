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
import { Scale, TrendingDown, Save, Database, FileDown, FileText } from "lucide-react";
import { exportToExcel, exportToPdf, type ExportColumn } from "@/lib/exports";

type Seg = "PROFILED" | "MEASURED" | "PV";
const ALL_SEGS: Seg[] = ["PROFILED", "MEASURED", "PV"];

/**
 * Imbalance settlement with DUAL ACTUAL:
 *  - internal  = own (Kimi) meters — available same day, steers the business,
 *                but not recognised by anyone outside;
 *  - official  = DSO/EVN data — arrives days later, is what MEPSO actually
 *                settles against.
 * Settlement uses official when present (FINAL), internal otherwise
 * (PROVISIONAL estimate). The gap between the two columns measures own-meter
 * coverage/quality.
 */
type Row = { segment: Seg; scheduled: number; actualInternal: number | null; actualOfficial: number | null };

export default function Settlement() {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [bg, setBg] = useState<string>("");
  const [dual, setDual] = useState(false);
  const [singlePrice, setSinglePrice] = useState(85);
  const [upPrice, setUpPrice] = useState(125);
  const [downPrice, setDownPrice] = useState(45);
  const [computing, setComputing] = useState(false);
  const [computedAt, setComputedAt] = useState<Date | null>(null);
  const [rows, setRows] = useState<Row[]>(ALL_SEGS.map(s => ({ segment: s, scheduled: 0, actualInternal: null, actualOfficial: null })));
  const [activeSegs, setActiveSegs] = useState<Set<Seg>>(new Set(ALL_SEGS));

  useEffect(() => { supabase.from("balance_groups").select("id,name").then(({ data }) => { setGroups(data ?? []); if (data?.[0]) setBg(data[0].id); }); }, []);

  const periodBounds = () => {
    const [y, m] = period.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { start, end };
  };

  async function computeFromData() {
    if (!bg) { toast({ title: "Pick a balance group", variant: "destructive" }); return; }
    setComputing(true);
    try {
      const { start, end } = periodBounds();

      // 1) Scheduled per segment — latest published version per day
      const { data: sched } = await supabase.from("balance_schedules")
        .select("date, mtu, scheduled_mwh, leg, version")
        .eq("balance_group_id", bg).gte("date", start).lte("date", end);
      const maxVByDate = new Map<string, number>();
      for (const r of (sched ?? []) as any[]) {
        maxVByDate.set(r.date, Math.max(maxVByDate.get(r.date) ?? 0, r.version));
      }
      const schedBySeg: Record<Seg, number> = { PROFILED: 0, MEASURED: 0, PV: 0 };
      for (const r of (sched ?? []) as any[]) {
        if (r.version !== maxVByDate.get(r.date)) continue;
        schedBySeg[r.leg as Seg] += Number(r.scheduled_mwh || 0);
      }

      // 2) Actuals per segment — internal (own meters) vs official (DSO)
      const { data: cps } = await (supabase.from as any)("connection_points")
        .select("metering_point_id, metering_category").eq("balance_group_id", bg).eq("status", "active");
      const segOf = new Map<string, Seg>();
      ((cps ?? []) as any[]).forEach(c => { if (c.metering_point_id) segOf.set(c.metering_point_id, c.metering_category === "MEASURED" ? "MEASURED" : "PROFILED"); });
      const internal: Record<Seg, number | null> = { PROFILED: null, MEASURED: null, PV: null };
      const official: Record<Seg, number | null> = { PROFILED: null, MEASURED: null, PV: null };
      if (segOf.size) {
        const { data: iv } = await supabase.from("consumption_readings")
          .select("metering_point_id, reading_at, actual_mwh, source, quality")
          .gte("reading_at", `${start}T00:00:00Z`).lte("reading_at", `${end}T23:59:59Z`)
          .in("metering_point_id", [...segOf.keys()]).limit(100000);
        for (const r of ((iv ?? []) as any[])) {
          if ((r.quality ?? "measured") === "flagged") continue;
          const seg = segOf.get(r.metering_point_id); if (!seg) continue;
          const isOfficial = r.source === "DSO_INTERVAL" || r.source === "DSO_MONTHLY";
          const target = isOfficial ? official : internal;
          target[seg] = (target[seg] ?? 0) + Number(r.actual_mwh || 0);
        }
      }
      // PV production telemetry not wired yet — PV actual stays manual/null.
      setRows(ALL_SEGS.map(s => ({
        segment: s,
        scheduled: +schedBySeg[s].toFixed(3),
        actualInternal: internal[s] === null ? null : +(internal[s] as number).toFixed(3),
        actualOfficial: official[s] === null ? null : +(official[s] as number).toFixed(3),
      })));
      setComputedAt(new Date());
      const offSegs = ALL_SEGS.filter(s => official[s] !== null).length;
      toast({ title: "Computed from data", description: `Scheduled from ${maxVByDate.size} day(s) of schedules · official data for ${offSegs}/3 segments${offSegs < 3 ? " — provisional until DSO data lands" : ""}` });
    } finally { setComputing(false); }
  }

  const enriched = useMemo(() => rows.filter(r => activeSegs.has(r.segment)).map(r => {
    const actual = r.actualOfficial ?? r.actualInternal; // official wins when present
    const basis: "OFFICIAL" | "INTERNAL" | "NONE" = r.actualOfficial !== null ? "OFFICIAL" : r.actualInternal !== null ? "INTERNAL" : "NONE";
    const imb = actual === null ? 0 : actual - r.scheduled;
    const price = dual ? (imb >= 0 ? downPrice : upPrice) : singlePrice;
    const meterGap = r.actualOfficial !== null && r.actualInternal !== null && r.actualOfficial !== 0
      ? ((r.actualInternal - r.actualOfficial) / r.actualOfficial) * 100 : null; // own-meter quality metric
    return { ...r, actual: actual ?? 0, basis, imbalance: imb, price, cost: imb * price, meterGap };
  }), [rows, dual, singlePrice, upPrice, downPrice, activeSegs]);

  const allOfficial = enriched.every(r => r.basis === "OFFICIAL");
  const totals = enriched.reduce((s, r) => ({
    scheduled: s.scheduled + r.scheduled, actual: s.actual + r.actual,
    imbalance: s.imbalance + r.imbalance, cost: s.cost + r.cost,
  }), { scheduled: 0, actual: 0, imbalance: 0, cost: 0 });

  async function persist(status: "PROVISIONAL" | "FINAL") {
    if (status === "FINAL" && !allOfficial) {
      toast({ title: "Cannot mark FINAL", description: "Official (DSO) data is missing for some segments — save provisional instead.", variant: "destructive" });
      return;
    }
    const { start, end } = periodBounds();
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

  const exportCols: ExportColumn[] = [
    { key: "segment", label: "Segment" },
    { key: "scheduled", label: "Scheduled MWh", format: "num" },
    { key: "actualInternal", label: "Actual internal MWh", format: "num" },
    { key: "actualOfficial", label: "Actual official MWh", format: "num" },
    { key: "basis", label: "Basis" },
    { key: "imbalance", label: "Imbalance MWh", format: "num" },
    { key: "price", label: "Price €/MWh", format: "eur" },
    { key: "cost", label: "Cost €", format: "eur" },
  ];
  const segTag = activeSegs.size === ALL_SEGS.length ? "ALL" : Array.from(activeSegs).join("-");
  const fileBase = `settlement_${period}_${segTag}${bg ? "_" + (groups.find(g => g.id === bg)?.name ?? "bg").replace(/\s+/g, "_") : ""}`;
  function handleCsv() {
    const header = exportCols.map(c => c.label).join(",");
    const lines = enriched.map(r => exportCols.map(c => {
      const v = (r as any)[c.key];
      return typeof v === "number" ? v : `"${String(v ?? "").replace(/"/g, '""')}"`;
    }).join(","));
    const totalLine = ["TOTAL", totals.scheduled, "", "", "", totals.imbalance, "", totals.cost].join(",");
    const csv = [header, ...lines, totalLine].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${fileBase}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  function handleExcel() {
    exportToExcel(fileBase, [
      { name: "Segments", columns: exportCols, rows: enriched },
      { name: "Summary", columns: [
        { key: "k", label: "Metric" }, { key: "v", label: "Value" },
      ], rows: [
        { k: "Period", v: period },
        { k: "Balance group", v: groups.find(g => g.id === bg)?.name ?? "—" },
        { k: "Basis", v: allOfficial ? "OFFICIAL (final-grade)" : "Mixed / internal (provisional)" },
        { k: "Pricing", v: dual ? `Dual (up ${upPrice} / down ${downPrice})` : `Single ${singlePrice}` },
        { k: "Scheduled MWh", v: totals.scheduled.toFixed(2) },
        { k: "Actual MWh", v: totals.actual.toFixed(2) },
        { k: "Imbalance MWh", v: totals.imbalance.toFixed(2) },
        { k: "Imbalance cost €", v: totals.cost.toFixed(2) },
      ] },
    ]);
  }
  function handlePdf() {
    exportToPdf({
      title: `Settlement summary · ${period}`,
      subtitle: `${groups.find(g => g.id === bg)?.name ?? ""} · ${allOfficial ? "official basis" : "provisional (internal basis)"}`,
      filename: fileBase,
      sections: [
        {
          heading: "Per-segment settlement (dual actual)",
          columns: exportCols,
          rows: enriched,
          totals: { segment: "TOTAL", scheduled: totals.scheduled, imbalance: totals.imbalance, cost: totals.cost },
        },
        {
          heading: "Pricing parameters",
          columns: [{ key: "k", label: "Parameter" }, { key: "v", label: "Value" }],
          rows: [
            { k: "Pricing mode", v: dual ? "Dual" : "Single" },
            { k: "Single price €/MWh", v: dual ? "—" : singlePrice },
            { k: "Up regulation €/MWh", v: dual ? upPrice : "—" },
            { k: "Down regulation €/MWh", v: dual ? downPrice : "—" },
          ],
        },
      ],
    });
  }

  return (
    <ErpLayout title="Imbalance Settlement" subtitle="Dual actual: internal estimate now, official truth when DSO data lands"
      actions={<>
        <Button size="sm" variant="outline" onClick={computeFromData} disabled={computing}><Database className="h-4 w-4 mr-1" />{computing ? "Computing…" : "Compute from data"}</Button>
        <Button size="sm" variant="outline" onClick={handleCsv}><FileDown className="h-4 w-4 mr-1" />CSV</Button>
        <Button size="sm" variant="outline" onClick={handleExcel}><FileDown className="h-4 w-4 mr-1" />Excel</Button>
        <Button size="sm" variant="outline" onClick={handlePdf}><FileText className="h-4 w-4 mr-1" />PDF</Button>
        <Button size="sm" variant="outline" onClick={() => persist("PROVISIONAL")}><Save className="h-4 w-4 mr-1" />Save provisional</Button>
        <Button size="sm" onClick={() => persist("FINAL")} disabled={!allOfficial} title={allOfficial ? "" : "Official DSO data missing for some segments"}><Save className="h-4 w-4 mr-1" />Mark final</Button>
      </>}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Segments:</span>
        {ALL_SEGS.map(s => {
          const on = activeSegs.has(s);
          return (
            <Badge key={s} variant={on ? "default" : "outline"} className="cursor-pointer select-none"
              onClick={() => setActiveSegs(prev => {
                const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s);
                return next.size ? next : prev;
              })}>{s}</Badge>
          );
        })}
        {computedAt && <span className="text-xs text-muted-foreground ml-2">Computed {computedAt.toLocaleTimeString()}</span>}
        <Badge variant={allOfficial ? "default" : "outline"} className="ml-auto">{allOfficial ? "OFFICIAL BASIS" : "PROVISIONAL — internal basis"}</Badge>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Scheduled" value={`${totals.scheduled.toFixed(1)} MWh`} icon={Scale} />
        <StatCard label="Actual (settlement basis)" value={`${totals.actual.toFixed(1)} MWh`} icon={Scale} accent="accent" />
        <StatCard label="Imbalance" value={`${totals.imbalance >= 0 ? "+" : ""}${totals.imbalance.toFixed(1)} MWh`} icon={TrendingDown} accent={Math.abs(totals.imbalance) > 20 ? "destructive" : "primary"} />
        <StatCard label="Imbalance cost" value={`€ ${totals.cost.toFixed(0)}`} icon={Scale} accent={totals.cost < 0 ? "primary" : "warning"} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Pricing & period</CardTitle>
          <CardDescription>Compute pulls schedules + both actuals for the month; fields stay editable as trader override</CardDescription>
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
        <CardHeader>
          <CardTitle>Per-segment settlement — dual actual</CardTitle>
          <CardDescription>Basis: official (DSO) when present, otherwise internal (own meters). Gap % = internal vs official — your meter-coverage quality.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Segment</TableHead>
              <TableHead className="text-right">Scheduled</TableHead>
              <TableHead className="text-right">Actual · internal</TableHead>
              <TableHead className="text-right">Actual · official</TableHead>
              <TableHead>Basis</TableHead>
              <TableHead className="text-right">Gap %</TableHead>
              <TableHead className="text-right">Imbalance</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {enriched.map((r) => {
                const i = rows.findIndex(x => x.segment === r.segment);
                return (
                <TableRow key={r.segment}>
                  <TableCell><Badge variant="secondary">{r.segment}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums"><Input className="w-24 inline-block text-right" type="number" value={r.scheduled} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, scheduled: +e.target.value } : x))} /></TableCell>
                  <TableCell className="text-right tabular-nums"><Input className="w-24 inline-block text-right" type="number" value={r.actualInternal ?? ""} placeholder="—" onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, actualInternal: e.target.value === "" ? null : +e.target.value } : x))} /></TableCell>
                  <TableCell className="text-right tabular-nums"><Input className="w-24 inline-block text-right" type="number" value={r.actualOfficial ?? ""} placeholder="—" onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, actualOfficial: e.target.value === "" ? null : +e.target.value } : x))} /></TableCell>
                  <TableCell><Badge variant={r.basis === "OFFICIAL" ? "default" : "outline"}>{r.basis}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.meterGap === null ? "—" : `${r.meterGap > 0 ? "+" : ""}${r.meterGap.toFixed(1)}%`}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.imbalance.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">€ {r.price.toFixed(0)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">€ {r.cost.toFixed(0)}</TableCell>
                </TableRow>
              );})}
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
