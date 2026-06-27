import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { StatCard } from "@/components/erp/StatCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtMwh } from "@/lib/format";
import { Activity, Users, Zap, Euro, Database, Gauge } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { toast } from "sonner";
import { format } from "date-fns";

export default function Dashboard() {
  const { user } = useAuth();
  const [clientCount, setClientCount] = useState(0);
  const [edusCount, setEdusCount] = useState(0);
  const [hourly, setHourly] = useState<{ time: string; forecast: number; actual: number }[]>([]);
  const [prices, setPrices] = useState<{ time: string; price: number }[]>([]);
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    if (!user) return;
    const [{ count: cc }, { data: edus }, { data: pr }] = await Promise.all([
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase.from("metering_points").select("id, client:clients!inner(user_id)").eq("client.user_id", user.id),
      supabase.from("market_prices").select("delivery_at, price_eur_mwh").order("delivery_at", { ascending: true }).limit(48),
    ]);
    setClientCount(cc ?? 0);
    setEdusCount(edus?.length ?? 0);
    setPrices((pr ?? []).map(p => ({ time: format(new Date(p.delivery_at), "MM-dd HH:mm"), price: Number(p.price_eur_mwh) })));

    // Get readings for the most recent 24h
    const { data: meterIds } = await supabase.from("metering_points").select("id, client:clients!inner(user_id)").eq("client.user_id", user.id);
    const ids = (meterIds ?? []).map((m: any) => m.id);
    if (ids.length) {
      const { data: rd } = await supabase
        .from("consumption_readings")
        .select("reading_at, forecast_mwh, actual_mwh")
        .in("metering_point_id", ids)
        .order("reading_at", { ascending: true })
        .limit(2400);
      const byHour = new Map<string, { f: number; a: number }>();
      (rd ?? []).forEach((r: any) => {
        const k = format(new Date(r.reading_at), "MM-dd HH:00");
        const cur = byHour.get(k) ?? { f: 0, a: 0 };
        cur.f += Number(r.forecast_mwh ?? 0);
        cur.a += Number(r.actual_mwh ?? 0);
        byHour.set(k, cur);
      });
      const arr = Array.from(byHour.entries()).slice(-48).map(([time, v]) => ({ time, forecast: +v.f.toFixed(3), actual: +v.a.toFixed(3) }));
      setHourly(arr);
    } else {
      setHourly([]);
    }
  };

  useEffect(() => { load(); }, [user, period]);

  const seed = async () => {
    setSeeding(true);
    const { error } = await supabase.functions.invoke("seed-demo-data");
    setSeeding(false);
    if (error) toast.error(error.message); else { toast.success("Demo data loaded"); load(); }
  };

  const totalForecast = hourly.reduce((s, h) => s + h.forecast, 0);
  const totalActual = hourly.reduce((s, h) => s + h.actual, 0);
  const avgPrice = prices.length ? prices.reduce((s, p) => s + p.price, 0) / prices.length : 0;
  // MAPE over hourly pairs where actual > 0
  const mapePairs = hourly.filter(h => h.actual > 0);
  const mape = mapePairs.length > 0
    ? (mapePairs.reduce((s, h) => s + Math.abs((h.actual - h.forecast) / h.actual), 0) / mapePairs.length) * 100
    : null;

  return (
    <ErpLayout
      title="Energy Portfolio Dashboard"
      subtitle="Real-time overview of consumption, market prices and portfolio health"
      actions={<Button onClick={seed} disabled={seeding} variant="secondary"><Database className="h-4 w-4 mr-2" />{seeding ? "Loading…" : "Load demo data"}</Button>}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active clients" value={String(clientCount)} icon={Users} hint="Business contracts" />
        <StatCard label="Metering points" value={String(edusCount)} icon={Zap} accent="accent" hint="EDU codes under management" />
        <StatCard label="Avg HUPX (48h)" value={`${avgPrice.toFixed(2)} €/MWh`} icon={Activity} accent="warning" hint="Hourly day-ahead spot" />
        <StatCard
          label="Forecast accuracy (48h)"
          value={mape != null ? `${mape.toFixed(1)}% MAPE` : "—"}
          icon={Gauge}
          accent={mape != null && mape < 15 ? "primary" : "warning"}
          hint={`Actual ${fmtMwh(totalActual)} · Fcst ${fmtMwh(totalForecast)}`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 border-border/60">
          <CardHeader>
            <CardTitle>Hourly consumption — Forecast vs Actual</CardTitle>
            <CardDescription>Aggregated portfolio (last 48 hours)</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {hourly.length === 0 ? (
              <Empty msg="No consumption data yet. Load demo data or add readings." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hourly}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                  <Line type="monotone" dataKey="forecast" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="Forecast (MWh)" />
                  <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Actual (MWh)" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>HUPX day-ahead prices</CardTitle>
            <CardDescription>Hourly spot (€/MWh)</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {prices.length === 0 ? (
              <Empty msg="No market prices yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={prices}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} hide />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: any) => [`${v} €/MWh`, "Price"]} />
                  <Bar dataKey="price" fill="hsl(var(--primary))" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </ErpLayout>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="h-full grid place-items-center text-sm text-muted-foreground">{msg}</div>;
}