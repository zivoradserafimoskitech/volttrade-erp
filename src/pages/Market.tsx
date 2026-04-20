import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { format } from "date-fns";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";
import { Plus } from "lucide-react";

type Price = { id: string; delivery_at: string; price_eur_mwh: number };

export default function Market() {
  const [prices, setPrices] = useState<Price[]>([]);
  const load = async () => {
    const { data } = await supabase.from("market_prices").select("*").order("delivery_at", { ascending: false }).limit(168);
    setPrices(((data as any) ?? []).reverse());
  };
  useEffect(() => { load(); }, []);

  const add = async (form: FormData) => {
    const dt = String(form.get("delivery_at"));
    const price = Number(form.get("price"));
    const { error } = await supabase.from("market_prices").insert({ delivery_at: new Date(dt).toISOString(), price_eur_mwh: price });
    if (error) return toast.error(error.message);
    toast.success("Price added"); load();
  };

  const chartData = prices.map(p => ({ time: format(new Date(p.delivery_at), "MM-dd HH:mm"), price: Number(p.price_eur_mwh) }));
  const min = Math.min(...chartData.map(d => d.price), Infinity);
  const max = Math.max(...chartData.map(d => d.price), -Infinity);
  const avg = chartData.length ? chartData.reduce((s,d)=>s+d.price,0)/chartData.length : 0;

  return (
    <ErpLayout title="Market Prices" subtitle="HUPX-style hourly day-ahead prices (€/MWh)">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Records" value={String(chartData.length)} />
        <Stat label="Min" value={isFinite(min) ? `${fmtNum(min)} €` : "—"} />
        <Stat label="Avg" value={`${fmtNum(avg)} €`} accent />
        <Stat label="Max" value={isFinite(max) ? `${fmtNum(max)} €` : "—"} />
      </div>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Hourly trend</CardTitle><CardDescription>Last {chartData.length} hours</CardDescription></CardHeader>
        <CardContent className="h-80">
          {chartData.length === 0 ? <div className="h-full grid place-items-center text-sm text-muted-foreground">No prices yet.</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader><CardTitle>Distribution</CardTitle></CardHeader>
          <CardContent className="h-72">
            {chartData.length === 0 ? null : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.slice(-48)}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} hide />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="price" fill="hsl(var(--accent))" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader><CardTitle>Add price</CardTitle><CardDescription>Manual entry (MTU)</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); (e.target as HTMLFormElement).reset(); }} className="space-y-3">
              <div className="space-y-2"><Label htmlFor="delivery_at">Delivery hour</Label><Input id="delivery_at" name="delivery_at" type="datetime-local" required /></div>
              <div className="space-y-2"><Label htmlFor="price">Price (€/MWh)</Label><Input id="price" name="price" type="number" step="0.01" required /></div>
              <Button type="submit" className="w-full"><Plus className="h-4 w-4 mr-2" />Add</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </ErpLayout>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold mt-1 ${accent ? "text-primary" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}