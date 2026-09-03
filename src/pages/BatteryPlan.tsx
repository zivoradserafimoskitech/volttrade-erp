import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/erp/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { format, addDays } from "date-fns";
import { Battery, BatteryCharging, Euro, Gauge, Info } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine,
} from "recharts";

type Row = {
  delivery_date: string; hour_of_day: number;
  charge_mw: number | null; discharge_mw: number | null; soc_pct: number | null;
  price_forecast_eur_mwh: number | null; revenue_eur: number | null;
};

const n2 = (v: number) => v.toFixed(2);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const num = (v: number | null) => (v == null ? 0 : Number(v));

export default function BatteryPlan() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [fallbackDate, setFallbackDate] = useState<string | null>(null);

  const tomorrow = useMemo(() => format(addDays(new Date(), 1), "yyyy-MM-dd"), []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const cols = "delivery_date, hour_of_day, charge_mw, discharge_mw, soc_pct, price_forecast_eur_mwh, revenue_eur";
    const { data, error } = await (supabase.from as any)("bess_dispatch_schedules")
      .select(cols).eq("delivery_date", tomorrow).order("hour_of_day", { ascending: true });
    if (error) {
      toast({ title: "Could not load the dispatch plan", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    if ((data ?? []).length > 0) {
      setRows(data as Row[]);
      setFallbackDate(null);
    } else {
      // No plan for tomorrow yet — show the most recent day we do have.
      const { data: latest } = await (supabase.from as any)("bess_dispatch_schedules")
        .select("delivery_date").order("delivery_date", { ascending: false }).limit(1);
      const d = latest?.[0]?.delivery_date ?? null;
      if (d) {
        const { data: prev } = await (supabase.from as any)("bess_dispatch_schedules")
          .select(cols).eq("delivery_date", d).order("hour_of_day", { ascending: true });
        setRows((prev ?? []) as Row[]);
      } else {
        setRows([]);
      }
      setFallbackDate(d);
    }
    setLoading(false);
  }, [tomorrow]);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 300_000);
    return () => clearInterval(id);
  }, [load]);

  const chart = rows.map(r => ({
    hour: hh(r.hour_of_day),
    charge: num(r.charge_mw),
    discharge: -num(r.discharge_mw),
    soc: r.soc_pct == null ? null : Number(r.soc_pct),
    price: r.price_forecast_eur_mwh == null ? null : Number(r.price_forecast_eur_mwh),
  }));

  const totalCharge = rows.reduce((s, r) => s + num(r.charge_mw), 0);
  const totalDischarge = rows.reduce((s, r) => s + num(r.discharge_mw), 0);
  const endSoc = rows.length ? rows[rows.length - 1].soc_pct : null;
  const revenueRows = rows.filter(r => r.revenue_eur != null);
  const revenue = revenueRows.length ? revenueRows.reduce((s, r) => s + Number(r.revenue_eur), 0) : null;

  const shownDate = fallbackDate ?? tomorrow;

  return (
    <ErpLayout
      title="Battery — tomorrow's dispatch plan"
      subtitle={format(new Date(shownDate), "dd.MM.yyyy")}
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : (
        <>
          {fallbackDate && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-3 px-4 text-sm flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span>
                  No schedule for tomorrow yet — the daily optimisation runs at 14:30 UTC.
                  Showing the latest available plan for {format(new Date(fallbackDate), "dd.MM.yyyy")}.
                </span>
              </CardContent>
            </Card>
          )}

          {rows.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center text-muted-foreground">
                No schedule for tomorrow yet — the daily optimisation runs at 14:30 UTC.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Total charge" value={`${n2(totalCharge)} MWh`} icon={BatteryCharging} />
                <StatCard label="Total discharge" value={`${n2(totalDischarge)} MWh`} icon={Battery} />
                <StatCard label="End-of-day SoC" value={endSoc == null ? "—" : `${Number(endSoc).toFixed(1)} %`} icon={Gauge} />
                <StatCard label="Expected revenue" value={revenue == null ? "—" : `${n2(revenue)} EUR`} icon={Euro} />
              </div>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Charge / discharge and state of charge</CardTitle></CardHeader>
                <CardContent className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={11} interval={1} />
                      <YAxis yAxisId="mw" stroke="hsl(var(--muted-foreground))" fontSize={11}
                        label={{ value: "MW", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                      <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} unit="%" />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        formatter={(value: any, name: string) => {
                          if (value == null) return ["—", name];
                          if (name === "Discharge") return [`${n2(Math.abs(Number(value)))} MW`, name];
                          if (name === "SoC") return [`${Number(value).toFixed(1)} %`, name];
                          if (name === "Forecast price") return [`${n2(Number(value))} EUR/MWh`, name];
                          return [`${n2(Number(value))} MW`, name];
                        }}
                      />
                      <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine yAxisId="mw" y={0} stroke="hsl(var(--muted-foreground))" />
                      <Bar yAxisId="mw" dataKey="charge" name="Charge" fill="hsl(142 71% 45%)" radius={[2, 2, 0, 0]} />
                      <Bar yAxisId="mw" dataKey="discharge" name="Discharge" fill="hsl(217 91% 60%)" radius={[0, 0, 2, 2]} />
                      <Line yAxisId="soc" type="monotone" dataKey="soc" name="SoC" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} />
                      <Line yAxisId="mw" dataKey="price" name="Forecast price" stroke="transparent" dot={false} legendType="none" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Hourly plan</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hour</TableHead>
                        <TableHead className="text-right">Charge (MW)</TableHead>
                        <TableHead className="text-right">Discharge (MW)</TableHead>
                        <TableHead className="text-right">SoC (%)</TableHead>
                        <TableHead className="text-right">Forecast price (EUR/MWh)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(r => (
                        <TableRow key={r.hour_of_day}>
                          <TableCell className="font-medium">{hh(r.hour_of_day)}</TableCell>
                          <TableCell className="text-right tabular-nums">{n2(num(r.charge_mw))}</TableCell>
                          <TableCell className="text-right tabular-nums">{n2(num(r.discharge_mw))}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.soc_pct == null ? "—" : Number(r.soc_pct).toFixed(1)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.price_forecast_eur_mwh == null ? "—" : n2(Number(r.price_forecast_eur_mwh))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </ErpLayout>
  );
}
