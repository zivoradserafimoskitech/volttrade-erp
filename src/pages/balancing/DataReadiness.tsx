import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/erp/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Gauge, Play, AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * Data readiness for MEASURED (>40 kW) metering points. Tells you, per meter,
 * whether measurements are arriving, whether there are gaps, and when the
 * meter's own hourly curve activates. Zero meters with a curve at the start is
 * the expected state, not a fault.
 */
const MIN_HOURS_PER_DAY = 20;
const MIN_DAYS = 10;
const LOOKBACK_DAYS = 90;

type Row = {
  id: string; edu: string; client: string;
  firstReading: string | null; completeDays: number;
  coverage30: number; coverage7: number; flagged: number;
  combos: number; sampleDays: number;
};

export default function DataReadiness() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
      const [{ data: mps }, { data: profiles }] = await Promise.all([
        (supabase.from as any)("metering_points")
          .select("id, edu_code, client_id, clients(company_name)")
          .eq("status", "active").eq("metering_category", "MEASURED"),
        (supabase.from as any)("meter_load_profiles").select("metering_point_id, season, day_type, sample_days"),
      ]);
      const meters = (mps ?? []) as any[];
      if (!meters.length) { setRows([]); return; }

      const ids = meters.map(m => m.id);
      // Paginated read of the readings window
      const readings: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from("consumption_readings")
          .select("metering_point_id, reading_at, quality")
          .in("metering_point_id", ids).gte("reading_at", since)
          .order("reading_at").range(from, from + 999);
        const batch = data ?? [];
        readings.push(...batch);
        if (batch.length < 1000) break;
      }

      const now = Date.now();
      const d30 = now - 30 * 86400_000, d7 = now - 7 * 86400_000;
      const per = new Map<string, { days: Map<string, Set<number>>; first: string | null; flagged: number; h30: number; h7: number }>();
      for (const r of readings) {
        let p = per.get(r.metering_point_id);
        if (!p) { p = { days: new Map(), first: null, flagged: 0, h30: 0, h7: 0 }; per.set(r.metering_point_id, p); }
        if (r.quality === "flagged") { p.flagged++; continue; }
        const ts = new Date(r.reading_at);
        if (!p.first || r.reading_at < p.first) p.first = r.reading_at;
        const day = ts.toISOString().slice(0, 10);
        if (!p.days.has(day)) p.days.set(day, new Set());
        p.days.get(day)!.add(ts.getUTCHours());
        if (ts.getTime() >= d30) p.h30++;
        if (ts.getTime() >= d7) p.h7++;
      }

      const profBy = new Map<string, { combos: number; sample: number }>();
      for (const p of ((profiles ?? []) as any[])) {
        const e = profBy.get(p.metering_point_id) ?? { combos: 0, sample: 0 };
        e.combos += 1 / 24; // 24 rows per (season, day_type)
        e.sample = Math.max(e.sample, Number(p.sample_days || 0));
        profBy.set(p.metering_point_id, e);
      }

      setRows(meters.map(m => {
        const p = per.get(m.id);
        const completeDays = p ? Array.from(p.days.values()).filter(s => s.size >= MIN_HOURS_PER_DAY).length : 0;
        const pr = profBy.get(m.id);
        return {
          id: m.id, edu: m.edu_code, client: m.clients?.company_name ?? "—",
          firstReading: p?.first ?? null, completeDays,
          coverage30: p ? Math.min(100, (p.h30 / (30 * 24)) * 100) : 0,
          coverage7: p ? Math.min(100, (p.h7 / (7 * 24)) * 100) : 0,
          flagged: p?.flagged ?? 0,
          combos: pr ? Math.round(pr.combos) : 0,
          sampleDays: pr?.sample ?? 0,
        };
      }).sort((a, b) => b.completeDays - a.completeDays));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function build() {
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("build-meter-profiles", { body: {} });
      if (error) { toast({ title: "Profile build failed", description: error.message, variant: "destructive" }); return; }
      const d = data as any;
      toast({
        title: `${d.meters_with_profile} of ${d.meters_total} meters have a curve`,
        description: d.meters_with_profile === 0
          ? "Expected while history is still building — nomination stays on SLP fallback."
          : "Meters with their own curve now nominate from measured data.",
      });
      await load();
    } finally { setBuilding(false); }
  }

  const summary = useMemo(() => ({
    total: rows.length,
    active: rows.filter(r => r.sampleDays >= MIN_DAYS).length,
    collecting: rows.filter(r => r.sampleDays < MIN_DAYS && r.completeDays > 0).length,
    gaps: rows.filter(r => r.coverage7 < 90).length,
  }), [rows]);

  const status = (r: Row) => {
    if (r.sampleDays >= MIN_DAYS) return { dot: "🟢", text: "active curve" };
    if (r.completeDays > 0) return { dot: "🟡", text: `collecting (${r.completeDays}/${MIN_DAYS})` };
    return { dot: "🔴", text: "no data" };
  };

  return (
    <ErpLayout title="Data Readiness" subtitle="MEASURED (>40 kW) meters — when each one gets its own hourly curve"
      actions={<Button size="sm" onClick={build} disabled={building}><Play className="h-4 w-4 mr-1" />{building ? "Building…" : "Build profiles"}</Button>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Measured meters" value={String(summary.total)} icon={Gauge} />
        <StatCard label="Own curve active" value={String(summary.active)} icon={CheckCircle2} accent="primary" />
        <StatCard label="Still collecting" value={String(summary.collecting)} icon={Gauge} accent="accent" />
        <StatCard label="Coverage < 90% (7d)" value={String(summary.gaps)} icon={AlertTriangle} accent={summary.gaps ? "warning" : "primary"} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Per metering point</CardTitle>
          <CardDescription>
            A curve activates after {MIN_DAYS} complete days (≥{MIN_HOURS_PER_DAY} hours each). Until then the meter nominates
            on the SLP fallback — that is correct, not a defect. Coverage below 90% means communication gaps, which would
            distort a curve built from them.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Metering point</TableHead><TableHead>First reading</TableHead>
              <TableHead className="text-right">Complete days</TableHead>
              <TableHead className="text-right">Coverage 30d</TableHead>
              <TableHead className="text-right">Coverage 7d</TableHead>
              <TableHead className="text-right">Flagged</TableHead>
              <TableHead className="text-right">Combinations</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[180px]">To activation</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={9} className="text-muted-foreground">Loading…</TableCell></TableRow>}
              {!loading && !rows.length && <TableRow><TableCell colSpan={9} className="text-muted-foreground">No active MEASURED metering points.</TableCell></TableRow>}
              {rows.map(r => {
                const s = status(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell><div className="font-medium">{r.edu}</div><div className="text-xs text-muted-foreground">{r.client}</div></TableCell>
                    <TableCell className="text-xs">{r.firstReading ? new Date(r.firstReading).toISOString().slice(0, 10) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.completeDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.coverage30.toFixed(0)}%</TableCell>
                    <TableCell className={`text-right tabular-nums ${r.coverage7 < 90 ? "text-warning font-medium" : ""}`}>{r.coverage7.toFixed(0)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{r.flagged}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.combos}</TableCell>
                    <TableCell><Badge variant="secondary">{s.dot} {s.text}</Badge></TableCell>
                    <TableCell>
                      <Progress value={Math.min(100, (r.completeDays / MIN_DAYS) * 100)} />
                      <div className="text-[11px] text-muted-foreground mt-1">{Math.min(r.completeDays, MIN_DAYS)} of {MIN_DAYS} days to activation.</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}