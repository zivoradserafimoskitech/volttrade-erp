import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { allocateBySlp, hourlyRange, loadCurve, CurveLookup } from "@/lib/slp";
import { fmtNum } from "@/lib/format";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  mp_id: string; edu_code: string; category: string; profile?: string | null;
  annual_mwh: number; allocated_kwh: number; actual_kwh: number; readings: number;
};

export default function Reconciliation() {
  const { user } = useAuth();
  const now = new Date();
  const [ym, setYm] = useState<string>(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [tolerance, setTolerance] = useState<number>(5);
  const [category, setCategory] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const monthRange = useMemo(() => {
    const [y, m] = ym.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return { start, end, y, m };
  }, [ym]);

  const run = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: mps, error: e1 } = await supabase.from("metering_points")
        .select("id,edu_code,consumer_category,slp_profile_code,annual_consumption_mwh");
      if (e1) throw e1;

      const { data: rds, error: e2 } = await supabase.from("meter_readings")
        .select("metering_point_id,import_kwh,reading_at,validation_status")
        .gte("reading_at", monthRange.start.toISOString())
        .lt("reading_at", monthRange.end.toISOString())
        .neq("validation_status", "rejected");
      if (e2) throw e2;

      // group readings
      const agg = new Map<string, { kwh: number; n: number }>();
      (rds ?? []).forEach((r: any) => {
        const cur = agg.get(r.metering_point_id) ?? { kwh: 0, n: 0 };
        cur.kwh += Number(r.import_kwh ?? 0); cur.n += 1;
        agg.set(r.metering_point_id, cur);
      });

      // cache curves
      const curveCache = new Map<string, CurveLookup>();
      const yearStart = new Date(monthRange.y, 0, 1);
      const yearEnd = new Date(monthRange.y + 1, 0, 1);
      const allHours = hourlyRange(yearStart, yearEnd);
      const monthMask = allHours.map(h => h >= monthRange.start && h < monthRange.end);

      const out: Row[] = [];
      for (const mp of mps ?? []) {
        const annual = Number((mp as any).annual_consumption_mwh ?? 0);
        const cat = (mp as any).consumer_category ?? "smart_hourly";
        const profile = (mp as any).slp_profile_code as string | null;
        const actual = agg.get(mp.id);
        let allocated_kwh = 0;
        if (cat === "slp" && profile && annual > 0) {
          let curve = curveCache.get(profile);
          if (!curve) { curve = await loadCurve(profile); curveCache.set(profile, curve); }
          const perHour = allocateBySlp(annual * 1000, allHours, curve); // kWh per hour over year
          allocated_kwh = perHour.reduce((s, v, i) => s + (monthMask[i] ? v : 0), 0);
        } else {
          // smart meters: expected ≈ annual / 12 (kWh)
          allocated_kwh = (annual * 1000) / 12;
        }
        out.push({
          mp_id: mp.id, edu_code: (mp as any).edu_code, category: cat, profile,
          annual_mwh: annual,
          allocated_kwh,
          actual_kwh: actual?.kwh ?? 0,
          readings: actual?.n ?? 0,
        });
      }
      setRows(out);
    } catch (err: any) {
      toast.error(err.message ?? "Reconciliation failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { if (user) run(); /* eslint-disable-next-line */ }, [user, ym]);

  const filtered = category === "all" ? rows : rows.filter(r => r.category === category);
  const flagged = filtered.filter(r => {
    if (r.allocated_kwh <= 0) return r.actual_kwh > 0; // no baseline but data present
    const dev = Math.abs(r.actual_kwh - r.allocated_kwh) / r.allocated_kwh * 100;
    return dev > tolerance;
  });

  const totals = filtered.reduce((acc, r) => {
    acc.allocated += r.allocated_kwh; acc.actual += r.actual_kwh; return acc;
  }, { allocated: 0, actual: 0 });
  const overallDev = totals.allocated > 0
    ? ((totals.actual - totals.allocated) / totals.allocated) * 100 : 0;

  return (
    <ErpLayout title="Reconciliation" subtitle="Meter totals vs curve-allocated volumes — flag mismatches per EDU and month"
      actions={
        <Button onClick={run} disabled={loading} style={{ background: "var(--gradient-primary)" }}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Recalculate
        </Button>
      }>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="space-y-2"><Label>Month</Label><Input type="month" value={ym} onChange={e => setYm(e.target.value)} /></div>
        <div className="space-y-2"><Label>Tolerance (%)</Label><Input type="number" min={0} step={0.5} value={tolerance} onChange={e => setTolerance(Number(e.target.value))} /></div>
        <div className="space-y-2"><Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="slp">SLP (≤ 40 kW)</SelectItem>
              <SelectItem value="smart_daily">Smart daily (&gt; 40 kW)</SelectItem>
              <SelectItem value="smart_hourly">Smart hourly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label>Status</Label>
          <div className="h-10 flex items-center gap-2 text-sm">
            {flagged.length === 0 ? (
              <Badge variant="default" className="bg-emerald-600/80"><CheckCircle2 className="h-3 w-3 mr-1" />All within tolerance</Badge>
            ) : (
              <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />{flagged.length} flagged</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-border/60"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Allocated total</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{fmtNum(totals.allocated / 1000, 3)} MWh</div></CardContent></Card>
        <Card className="border-border/60"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Metered total</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{fmtNum(totals.actual / 1000, 3)} MWh</div></CardContent></Card>
        <Card className="border-border/60"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Overall deviation</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-semibold ${Math.abs(overallDev) > tolerance ? "text-destructive" : "text-emerald-500"}`}>{overallDev >= 0 ? "+" : ""}{fmtNum(overallDev, 2)}%</div></CardContent></Card>
      </div>

      <Card className="border-border/60">
        <CardHeader><CardTitle>EDU breakdown ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>EDU</TableHead><TableHead>Category</TableHead><TableHead>Profile</TableHead>
              <TableHead className="text-right">Allocated (kWh)</TableHead>
              <TableHead className="text-right">Metered (kWh)</TableHead>
              <TableHead className="text-right">Δ</TableHead>
              <TableHead className="text-right">Dev %</TableHead>
              <TableHead className="text-right">Readings</TableHead>
              <TableHead>Flag</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(r => {
                const delta = r.actual_kwh - r.allocated_kwh;
                const dev = r.allocated_kwh > 0 ? (delta / r.allocated_kwh) * 100 : (r.actual_kwh > 0 ? Infinity : 0);
                const bad = r.allocated_kwh > 0 ? Math.abs(dev) > tolerance : r.actual_kwh > 0;
                const missing = r.readings === 0;
                return (
                  <TableRow key={r.mp_id} className={bad ? "bg-destructive/5" : ""}>
                    <TableCell className="font-mono text-xs">{r.edu_code}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{r.category}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.profile ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.allocated_kwh, 1)}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.actual_kwh, 1)}</TableCell>
                    <TableCell className={`text-right ${bad ? "text-destructive" : ""}`}>{delta >= 0 ? "+" : ""}{fmtNum(delta, 1)}</TableCell>
                    <TableCell className={`text-right ${bad ? "text-destructive font-medium" : ""}`}>
                      {Number.isFinite(dev) ? `${dev >= 0 ? "+" : ""}${fmtNum(dev, 2)}%` : "n/a"}
                    </TableCell>
                    <TableCell className="text-right">{r.readings}</TableCell>
                    <TableCell>
                      {missing ? <Badge variant="secondary" className="text-[10px]">no data</Badge>
                        : bad ? <Badge variant="destructive" className="text-[10px]">mismatch</Badge>
                        : <Badge variant="default" className="text-[10px] bg-emerald-600/80">ok</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-10 text-sm text-muted-foreground">No supply points to reconcile.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}