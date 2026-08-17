import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/erp/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Activity, Play, Gauge, AlertTriangle, RotateCw } from "lucide-react";

/**
 * Smart-meter volume health. A private smart meter is not a billing meter: it
 * drifts against the official DSO reading. We keep a per-meter calibration
 * factor (official ÷ private over whole months) and show, per metering point,
 * whether its daily volume forecast is really coming from smart-meter data or
 * from a weaker fallback.
 */
type Row = {
  id: string; edu: string; category: string | null;
  calibration: number | null; calibrationAt: string | null; calibrationMonths: number | null;
  privateDays: number; officialDays: number;
  method: string | null; sampleDays: number; nextMwh: number | null;
};

const METHOD_LABEL: Record<string, string> = {
  smart_meter: "Smart meter (calibrated)",
  smart_meter_thin: "Smart meter (thin history)",
  dso_history: "DSO history",
  manual: "Annual consumption",
};

export default function SmartMeterHealth() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [horizon, setHorizon] = useState(7);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 60 * 86400_000).toISOString();
      const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
      const { data: mps } = await (supabase.from as any)("metering_points")
        .select("id, edu_code, slp_category, smart_meter_calibration, calibration_updated_at, calibration_months")
        .eq("status", "active").eq("metering_category", "PROFILED");
      const meters = (mps ?? []) as any[];
      const ids = meters.map(m => m.id);

      const priv = new Map<string, Set<string>>(), off = new Map<string, Set<string>>();
      for (let c = 0; c < ids.length; c += 100) {
        const chunk = ids.slice(c, c + 100);
        for (let from = 0; ; from += 1000) {
          const { data } = await (supabase.from as any)("consumption_readings")
            .select("metering_point_id, reading_at, source").in("metering_point_id", chunk)
            .gte("reading_at", since).order("reading_at").range(from, from + 999);
          const rs = (data ?? []) as any[];
          for (const r of rs) {
            const bag = r.source === "PRIVATE_SMART" ? priv : off;
            const s = bag.get(r.metering_point_id) ?? new Set<string>();
            s.add(String(r.reading_at).slice(0, 10)); bag.set(r.metering_point_id, s);
          }
          if (rs.length < 1000) break;
        }
      }

      const { data: fc } = await (supabase.from as any)("volume_forecast_daily")
        .select("metering_point_id, forecast_mwh, method, sample_days").eq("forecast_date", tomorrow);
      const fmap = new Map<string, any>();
      for (const f of ((fc ?? []) as any[])) fmap.set(f.metering_point_id, f);

      setRows(meters.map(m => {
        const f = fmap.get(m.id);
        return {
          id: m.id, edu: m.edu_code, category: m.slp_category,
          calibration: m.smart_meter_calibration == null ? null : Number(m.smart_meter_calibration),
          calibrationAt: m.calibration_updated_at, calibrationMonths: m.calibration_months,
          privateDays: priv.get(m.id)?.size ?? 0, officialDays: off.get(m.id)?.size ?? 0,
          method: f?.method ?? null, sampleDays: Number(f?.sample_days ?? 0),
          nextMwh: f ? Number(f.forecast_mwh) : null,
        };
      }).sort((a, b) => b.privateDays - a.privateDays));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function runForecast() {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("forecast-volume-daily", { body: { horizon_days: horizon } });
    setRunning(false);
    const res = data as any;
    if (error || !res?.ok) { toast({ title: "Forecast failed", description: res?.error ?? error?.message, variant: "destructive" }); return; }
    toast({ title: `${res.forecast_rows} daily forecasts written`, description: `${res.meters} profiled meters over ${res.horizon_days} days` });
    load();
  }

  const filtered = useMemo(() => rows.filter(r => !q || r.edu?.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const withSmart = rows.filter(r => r.privateDays >= 14).length;
  const calibrated = rows.filter(r => r.calibration != null).length;
  const drifting = rows.filter(r => r.calibration != null && Math.abs(r.calibration - 1) > 0.15);
  const covered = rows.filter(r => r.method?.startsWith("smart")).length;

  return (
    <ErpLayout title="Smart Meter Health" subtitle="Private smart-meter coverage, calibration against official readings, and daily volume forecast provenance">
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Meters with smart data" value={`${withSmart} / ${rows.length}`} icon={Activity} hint="≥ 14 days of PRIVATE_SMART readings in 60 days" />
          <StatCard label="Calibrated" value={String(calibrated)} icon={Gauge} hint="Official ÷ private over whole months" />
          <StatCard label="Drifting > 15%" value={String(drifting.length)} icon={AlertTriangle} hint="Check meter placement or CT ratio" />
          <StatCard label="Forecast from smart meter" value={`${covered} / ${rows.length}`} icon={Play} hint="Tomorrow's daily volume, rest on fallbacks" />
        </div>

        <Card className="border-border/60">
          <CardHeader className="flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Daily volume forecast</CardTitle>
              <CardDescription>Calibrates each meter monthly, then forecasts the day's kWh from the last 28 days per day type. The SLP curve still supplies the shape.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Input className="w-24" type="number" min={1} max={31} value={horizon} onChange={e => setHorizon(+e.target.value)} />
              <Button size="sm" onClick={runForecast} disabled={running}>
                {running ? <RotateCw className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}Run forecast
              </Button>
              <Input className="w-48" placeholder="Filter EDU code…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>EDU</TableHead><TableHead>SLP category</TableHead>
                <TableHead className="text-right">Smart days / 60</TableHead><TableHead className="text-right">Official days / 60</TableHead>
                <TableHead className="text-right">Calibration</TableHead><TableHead>Tomorrow's volume</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>}
                {!loading && !filtered.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No active profiled metering points.</TableCell></TableRow>}
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.edu}</TableCell>
                    <TableCell>{r.category ? r.category.replace(/_/g, " ") : <Badge variant="destructive">not set</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.privateDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.officialDays}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.calibration == null ? <span className="text-muted-foreground">—</span> : (
                        <span className={Math.abs(r.calibration - 1) > 0.15 ? "text-destructive" : ""}>
                          {r.calibration.toFixed(3)}{r.calibrationMonths ? ` (${r.calibrationMonths} mo)` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.nextMwh == null ? <span className="text-muted-foreground">no forecast</span> : (
                        <>
                          <span className="tabular-nums">{r.nextMwh.toFixed(3)} MWh</span>{" "}
                          <Badge variant={r.method?.startsWith("smart") ? "default" : "secondary"}>{METHOD_LABEL[r.method ?? ""] ?? r.method}</Badge>
                          {r.sampleDays ? <span className="text-muted-foreground"> · {r.sampleDays} sample days</span> : null}
                        </>
                      )}
                    </TableCell>
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
