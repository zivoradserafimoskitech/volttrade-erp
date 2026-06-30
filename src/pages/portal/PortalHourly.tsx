import { useEffect, useMemo, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtNum } from "@/lib/format";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Activity, Download } from "lucide-react";

const EMBER = "#FF6B2C";
const FORECAST = "#7FB3FF";

// Synthetic 24h shape used to spread a daily forecast across hours when only
// daily resolution is available — peaks morning + evening, low overnight.
const HOUR_SHAPE = Array.from({ length: 24 }, (_, h) => {
  const morning = Math.exp(-Math.pow((h - 8) / 3, 2));
  const evening = 1.2 * Math.exp(-Math.pow((h - 20) / 2.5, 2));
  const base = 0.35;
  return base + morning + evening;
});
const SHAPE_SUM = HOUR_SHAPE.reduce((s, x) => s + x, 0);

type Row = { ts: string; date: string; hour: number; actual: number; export_kwh: number; forecast: number };

export default function PortalHourly() {
  const { user } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [mps, setMps] = useState<any[]>([]);
  const [mpId, setMpId] = useState<string>("");
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400e3).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  // load client + EDUs
  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    setClientId(cl.id);
    const { data: m } = await supabase.from("metering_points").select("id, ean, address").eq("client_id", cl.id);
    setMps(m ?? []);
    if (m && m.length && !mpId) setMpId(m[0].id);
  })(); }, [user]);

  // load readings + forecasts
  useEffect(() => { (async () => {
    if (!mpId || !clientId) return;
    setLoading(true);
    const fromIso = `${from}T00:00:00Z`;
    const toIso = `${to}T23:59:59Z`;
    const [{ data: rd }, { data: fc }] = await Promise.all([
      supabase.from("meter_readings")
        .select("reading_at, import_kwh, export_kwh")
        .eq("metering_point_id", mpId)
        .gte("reading_at", fromIso).lte("reading_at", toIso)
        .order("reading_at", { ascending: true }).limit(2000),
      supabase.from("forecasts")
        .select("forecast_date, forecast_mwh")
        .eq("client_id", clientId)
        .gte("forecast_date", from).lte("forecast_date", to),
    ]);
    // Build forecast kWh per hour by spreading daily MWh across 24h via HOUR_SHAPE
    const fcByDate: Record<string, number[]> = {};
    (fc ?? []).forEach((f: any) => {
      const daily_kwh = Number(f.forecast_mwh || 0) * 1000;
      fcByDate[f.forecast_date] = HOUR_SHAPE.map(w => (daily_kwh * w) / SHAPE_SUM);
    });
    // Build hourly map of actuals
    const bucket: Record<string, Row> = {};
    (rd ?? []).forEach((r: any) => {
      const d = new Date(r.reading_at);
      const date = d.toISOString().slice(0, 10);
      const hour = d.getUTCHours();
      const key = `${date}T${String(hour).padStart(2, "0")}`;
      if (!bucket[key]) bucket[key] = { ts: key, date, hour, actual: 0, export_kwh: 0, forecast: 0 };
      bucket[key].actual += Number(r.import_kwh || 0);
      bucket[key].export_kwh += Number(r.export_kwh || 0);
    });
    // Ensure every hour in window has a row (so forecast still plots without readings)
    const start = new Date(`${from}T00:00:00Z`).getTime();
    const end = new Date(`${to}T23:00:00Z`).getTime();
    for (let t = start; t <= end; t += 3600e3) {
      const d = new Date(t);
      const date = d.toISOString().slice(0, 10);
      const hour = d.getUTCHours();
      const key = `${date}T${String(hour).padStart(2, "0")}`;
      if (!bucket[key]) bucket[key] = { ts: key, date, hour, actual: 0, export_kwh: 0, forecast: 0 };
      bucket[key].forecast = fcByDate[date]?.[hour] ?? 0;
    }
    setRows(Object.values(bucket).sort((a, b) => a.ts.localeCompare(b.ts)));
    setLoading(false);
  })(); }, [mpId, clientId, from, to]);

  const totals = useMemo(() => {
    const a = rows.reduce((s, r) => s + r.actual, 0);
    const f = rows.reduce((s, r) => s + r.forecast, 0);
    const e = rows.reduce((s, r) => s + r.export_kwh, 0);
    const dev = f ? ((a - f) / f) * 100 : 0;
    // MAPE on hours with forecast > 0
    const used = rows.filter(r => r.forecast > 0);
    const mape = used.length ? (used.reduce((s, r) => s + Math.abs(r.actual - r.forecast) / Math.max(r.forecast, 0.001), 0) / used.length) * 100 : 0;
    return { actual: a, forecast: f, export: e, dev, mape };
  }, [rows]);

  const downloadCsv = () => {
    const header = "timestamp,date,hour,import_kwh,export_kwh,forecast_kwh,delta_kwh\n";
    const body = rows.map(r => [
      `${r.date}T${String(r.hour).padStart(2, "0")}:00:00Z`,
      r.date, r.hour, r.actual.toFixed(3), r.export_kwh.toFixed(3),
      r.forecast.toFixed(3), (r.actual - r.forecast).toFixed(3),
    ].join(",")).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hourly-${mpId}-${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PortalLayout title="Hourly readings">
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">Supply point</Label>
            <Select value={mpId} onValueChange={setMpId}>
              <SelectTrigger><SelectValue placeholder="Select EDU" /></SelectTrigger>
              <SelectContent>
                {mps.map(m => <SelectItem key={m.id} value={m.id}>{m.address || m.ean}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <Button variant="outline" onClick={downloadCsv} disabled={!rows.length}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Actual consumption" value={`${fmtNum(totals.actual)} kWh`} />
        <Kpi label="Forecast" value={`${fmtNum(totals.forecast)} kWh`} sub={totals.forecast ? "From daily forecast, hourly profile" : "No forecast in range"} />
        <Kpi label="Deviation" value={`${totals.dev > 0 ? "+" : ""}${totals.dev.toFixed(1)}%`} sub="Actual vs forecast" accent={Math.abs(totals.dev) > 10} />
        <Kpi label="MAPE (hourly)" value={totals.mape ? `${totals.mape.toFixed(1)}%` : "—"} sub="Mean abs. % error" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" style={{ color: EMBER }} /> Hourly profile</CardTitle>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: EMBER }} /> Actual (kWh)</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: FORECAST }} /> Forecast (kWh)</span>
          </div>
        </CardHeader>
        <CardContent className="h-80">
          {loading ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">No data for this range.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                <XAxis dataKey="ts" fontSize={10} interval={Math.max(1, Math.floor(rows.length / 12))}
                       tickFormatter={(v: string) => v.slice(5).replace("T", " ") + ":00"}
                       stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "#1A140F", border: "1px solid #3A3128", borderRadius: 8, fontSize: 12 }}
                         labelFormatter={(v: string) => `${v.slice(0, 10)} ${v.slice(11)}:00`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="actual" name="Actual" fill={EMBER} radius={[2, 2, 0, 0]} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke={FORECAST} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Hourly breakdown</CardTitle></CardHeader>
        <CardContent className="p-0 max-h-[480px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Hour</TableHead>
                <TableHead className="text-right">Import (kWh)</TableHead>
                <TableHead className="text-right">Export (kWh)</TableHead>
                <TableHead className="text-right">Forecast (kWh)</TableHead>
                <TableHead className="text-right">Δ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 500).map(r => {
                const delta = r.actual - r.forecast;
                const pct = r.forecast ? (delta / r.forecast) * 100 : 0;
                return (
                  <TableRow key={r.ts}>
                    <TableCell className="text-xs">{r.date}</TableCell>
                    <TableCell className="text-xs font-mono">{String(r.hour).padStart(2, "0")}:00</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(r.actual)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.export_kwh ? fmtNum(r.export_kwh) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.forecast ? fmtNum(r.forecast) : "—"}</TableCell>
                    <TableCell className="text-right">
                      {r.forecast ? (
                        <Badge variant="outline" className="tabular-nums"
                               style={{ borderColor: Math.abs(pct) > 15 ? "#ef4444" : "transparent",
                                        color: delta >= 0 ? EMBER : "#7FB3FF" }}>
                          {delta > 0 ? "+" : ""}{fmtNum(delta)} ({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length > 500 && (
                <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">Showing first 500 of {rows.length} rows. Export CSV for the full set.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PortalLayout>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className="overflow-hidden relative">
      {accent && <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: "#ef4444" }} />}
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}