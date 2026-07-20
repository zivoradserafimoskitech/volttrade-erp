import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/erp/StatCard";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, Gauge, RefreshCw, TrendingUp } from "lucide-react";

/**
 * Live portfolio position — the steering wheel, not the rear-view mirror.
 * Hour by hour for today: what our own (Kimi) meters actually measured vs
 * what was nominated (balance_schedules). Deviations show up within the hour,
 * while intraday correction is still possible — instead of 45 days later in
 * official settlement. Internal data by design: official DSO data arrives too
 * late to steer by.
 */
export default function LivePosition() {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [bg, setBg] = useState<string>("");
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [alarmPct, setAlarmPct] = useState(5);
  const [version, setVersion] = useState<number | null>(null);
  const [scheduled, setScheduled] = useState<number[]>(Array(24).fill(0)); // MWh/h (NOP)
  const [actual, setActual] = useState<(number | null)[]>(Array(24).fill(null)); // MWh/h
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    supabase.from("balance_groups").select("id,name").then(({ data }) => {
      setGroups(data ?? []); if (data?.[0]) setBg(data[0].id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!bg) return;
    setLoading(true);
    try {
      // 1) Nominated NOP per hour — latest published version for the day
      const { data: sched } = await supabase.from("balance_schedules")
        .select("mtu, scheduled_mwh, leg, version")
        .eq("balance_group_id", bg).eq("date", date);
      const maxV = (sched ?? []).reduce((m: number, r: any) => Math.max(m, r.version), 0);
      setVersion(maxV || null);
      const nop = Array(24).fill(0);
      for (const r of (sched ?? []) as any[]) {
        if (r.version !== maxV) continue;
        const h = Math.floor(r.mtu / 4);
        const sign = r.leg === "PV" ? -1 : 1;
        nop[h] += sign * Number(r.scheduled_mwh || 0);
      }
      setScheduled(nop);

      // 2) Actual per hour from own meters (internal, non-flagged), scoped to
      //    the balance group's metering points
      const { data: cps } = await (supabase.from as any)("metering_points")
        .select("id").eq("balance_group_id", bg).eq("status", "active");
      const mpIds = ((cps ?? []) as any[]).map(c => c.id);
      const act: (number | null)[] = Array(24).fill(null);
      if (mpIds.length) {
        const { data: iv } = await supabase.from("consumption_readings")
          .select("metering_point_id, reading_at, actual_mwh, quality")
          .gte("reading_at", `${date}T00:00:00Z`).lte("reading_at", `${date}T23:59:59Z`)
          .in("metering_point_id", mpIds).limit(50000);
        for (const r of ((iv ?? []) as any[])) {
          if ((r.quality ?? "measured") === "flagged") continue;
          const h = new Date(r.reading_at).getUTCHours();
          act[h] = (act[h] ?? 0) + Number(r.actual_mwh || 0);
        }
      }
      setActual(act);
      setLastRefresh(new Date());
    } finally { setLoading(false); }
  }, [bg, date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 5 * 60_000); return () => clearInterval(t); }, [load]); // live: refresh every 5 min

  const rows = useMemo(() => {
    let cum = 0;
    return Array.from({ length: 24 }, (_, h) => {
      const a = actual[h];
      const s = scheduled[h];
      const dev = a === null ? null : a - s;
      if (dev !== null) cum += dev;
      const devPct = dev !== null && s !== 0 ? (dev / Math.abs(s)) * 100 : null;
      return {
        h, label: `${String(h).padStart(2, "0")}:00`,
        actual: a === null ? null : +a.toFixed(3),
        scheduled: +s.toFixed(3),
        deviation: dev === null ? null : +dev.toFixed(3),
        devPct: devPct === null ? null : +devPct.toFixed(1),
        cum: a === null ? null : +cum.toFixed(3),
        breach: devPct !== null && Math.abs(devPct) > alarmPct,
      };
    });
  }, [actual, scheduled, alarmPct]);

  const totals = useMemo(() => {
    const measuredHours = rows.filter(r => r.actual !== null);
    const actSum = measuredHours.reduce((s, r) => s + (r.actual ?? 0), 0);
    const schedSum = measuredHours.reduce((s, r) => s + r.scheduled, 0);
    const dev = actSum - schedSum;
    const devPct = schedSum !== 0 ? (dev / Math.abs(schedSum)) * 100 : 0;
    // Naive projection: keep the current deviation rate for the remaining scheduled hours
    const remainingSched = rows.filter(r => r.actual === null).reduce((s, r) => s + r.scheduled, 0);
    const projDayEnd = dev + (schedSum !== 0 ? remainingSched * (dev / schedSum) : 0);
    const breaches = rows.filter(r => r.breach).length;
    return { actSum, schedSum, dev, devPct, projDayEnd, breaches, hours: measuredHours.length };
  }, [rows]);

  const devAccent = Math.abs(totals.devPct) > alarmPct ? "warning" : "primary";

  return (
    <ErpLayout title="Live Position" subtitle="Own-meter actuals vs nominated schedule · intraday steering (internal data)"
      actions={<>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </>}>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label={`Actual (${totals.hours}h)`} value={`${totals.actSum.toFixed(2)} MWh`} icon={Activity} />
        <StatCard label="Scheduled (same hours)" value={`${totals.schedSum.toFixed(2)} MWh`} icon={Gauge} accent="accent" />
        <StatCard label="Deviation" value={`${totals.dev >= 0 ? "+" : ""}${totals.dev.toFixed(2)} MWh (${totals.devPct.toFixed(1)}%)`} icon={AlertTriangle} accent={devAccent} />
        <StatCard label="Projected day-end" value={`${totals.projDayEnd >= 0 ? "+" : ""}${totals.projDayEnd.toFixed(2)} MWh`} icon={TrendingUp} accent={Math.abs(totals.projDayEnd) > Math.abs(totals.dev) ? "warning" : "primary"} />
        <StatCard label="Alarm hours" value={String(totals.breaches)} icon={AlertTriangle} accent={totals.breaches > 0 ? "warning" : "primary"} />
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-end justify-between">
          <div>
            <CardTitle>Hourly position — {date}{version ? ` · schedule v${version}` : " · no schedule published"}</CardTitle>
            <CardDescription>
              Bars: measured (Kimi). Line: nominated NOP. Dashed: cumulative deviation.
              {lastRefresh ? ` Refreshed ${lastRefresh.toLocaleTimeString()}.` : ""} Auto-refresh 5 min.
            </CardDescription>
          </div>
          <div className="flex items-end gap-3">
            <div className="space-y-1"><Label className="text-xs">Balance group</Label>
              <Select value={bg} onValueChange={setBg}><SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-[150px]" /></div>
            <div className="space-y-1"><Label className="text-xs">Alarm ±%</Label>
              <Input type="number" value={alarmPct} onChange={e => setAlarmPct(Number(e.target.value) || 0)} className="w-[80px]" /></div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} minTickGap={30} />
              <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
              <Bar dataKey="actual" name="Actual MWh" fill="hsl(var(--primary))" />
              <Line dataKey="scheduled" name="Scheduled NOP" stroke="hsl(var(--accent-foreground))" dot={false} strokeWidth={2} />
              <Line dataKey="cum" name="Cumulative deviation" stroke="hsl(var(--destructive))" strokeDasharray="5 4" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-4 grid grid-cols-6 md:grid-cols-12 gap-1">
            {rows.map(r => (
              <div key={r.h} className={`rounded px-1 py-1 text-center text-[10px] border ${r.breach ? "border-destructive text-destructive font-semibold" : r.actual === null ? "border-border/40 text-muted-foreground" : "border-border/60"}`}>
                <div>{r.label}</div>
                <div>{r.devPct === null ? "—" : `${r.devPct > 0 ? "+" : ""}${r.devPct}%`}</div>
              </div>
            ))}
          </div>
          {totals.breaches > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {totals.breaches} hour(s) beyond ±{alarmPct}% — consider an intraday correction for the remaining hours.
              <Badge variant="outline" className="ml-1">projected day-end {totals.projDayEnd >= 0 ? "+" : ""}{totals.projDayEnd.toFixed(2)} MWh</Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </ErpLayout>
  );
}
