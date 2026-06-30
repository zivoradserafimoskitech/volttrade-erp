import { useEffect, useMemo, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Cell,
} from "recharts";
import { Zap, TrendingDown, Clock, Check, ArrowRight, Sparkles, Sun, Car, ShieldCheck } from "lucide-react";
import { syntheticPrices } from "@/lib/evOptimiser";

const EMBER = "#FF6B2C";

type Plan = { code: string; name: string; tag: string; unit: string; standing: string; perks: string[]; icon: any; recommended?: boolean };
const PLANS: (Plan & { unitEurKwh: number | ((avgWholesaleEurMwh: number) => number); standingEurDay: number; nightShare?: number; nightEurKwh?: number })[] = [
  { code: "fixed_12", name: "Vatra Fixed 12", tag: "Stability", unit: "€0.142 / kWh", standing: "€0.18 / day",
    perks: ["Locked rate for 12 months", "No surprises", "Switch any time"], icon: ShieldCheck,
    unitEurKwh: 0.142, standingEurDay: 0.18 },
  { code: "tracker",  name: "Vatra Tracker",  tag: "Wholesale-linked", unit: "Daily wholesale + €0.025", standing: "€0.18 / day",
    perks: ["Follows the wholesale market", "Updated every day", "Typically cheaper than fixed"], icon: TrendingDown, recommended: true,
    unitEurKwh: (w) => w / 1000 + 0.025, standingEurDay: 0.18 },
  { code: "agile",    name: "Vatra Agile",    tag: "Half-hourly", unit: "Updates every 30 minutes", standing: "€0.20 / day",
    perks: ["Cheapest at night and midday", "Great with smart appliances", "See tomorrow's prices at 4pm"], icon: Sparkles,
    unitEurKwh: (w) => w / 1000 + 0.018, standingEurDay: 0.20 },
  { code: "go_ev",    name: "Vatra Go (EV)",  tag: "EV drivers", unit: "€0.075 / kWh 00:30–05:30", standing: "€0.20 / day",
    perks: ["Ultra-cheap overnight slot", "Smart-charge friendly", "Standard rate the rest of the day"], icon: Car,
    unitEurKwh: 0.155, standingEurDay: 0.20, nightShare: 0.21, nightEurKwh: 0.075 },
];

function colorFor(price: number, min: number, max: number) {
  if (max === min) return "#22c55e";
  const t = (price - min) / (max - min);
  if (t < 0.33) return "#22c55e";
  if (t < 0.66) return "#f59e0b";
  return "#ef4444";
}

export default function PortalTariffs() {
  const { user } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [currentTariff, setCurrentTariff] = useState<string | null>(null);
  const [prices, setPrices] = useState<{ ts: string; price: number; label: string }[]>([]);
  const [trend, setTrend] = useState<{ day: string; price: number }[]>([]);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [monthlyKwh, setMonthlyKwh] = useState<number>(0);
  const [avgWholesale, setAvgWholesale] = useState<number>(0);
  const [confirmPlan, setConfirmPlan] = useState<Plan | null>(null);

  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    setClientId(cl.id);
    const { data: sc } = await supabase.from("supply_contracts").select("tariff_id, tariffs(code,name)").eq("client_id", cl.id).eq("status","active").limit(1).maybeSingle();
    setCurrentTariff((sc as any)?.tariffs?.name ?? null);
    const { data: psw } = await supabase.from("tariff_switch_requests").select("target_tariff_code").eq("client_id", cl.id).eq("status","pending").maybeSingle();
    setPendingCode(psw?.target_tariff_code ?? null);

    // Estimate monthly kWh from last 30 days of meter readings
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    const { data: mrs } = await supabase
      .from("meter_readings")
      .select("kwh, metering_points!inner(client_id)")
      .gte("ts", since)
      .eq("metering_points.client_id", cl.id);
    const total = (mrs ?? []).reduce((s: number, r: any) => s + Number(r.kwh || 0), 0);
    setMonthlyKwh(total > 0 ? Math.round(total) : 320);

    // Half-hourly forward curve for the next 48h
    const now = new Date(); now.setMinutes(0,0,0);
    const end = new Date(now.getTime() + 48 * 3600e3);
    const { data: mp } = await supabase.from("market_prices")
      .select("delivery_at, price_eur_mwh")
      .gte("delivery_at", now.toISOString()).lte("delivery_at", end.toISOString())
      .order("delivery_at", { ascending: true });
    let curve = (mp ?? []).map(r => ({ ts: r.delivery_at as string, price: Number(r.price_eur_mwh) }));
    if (curve.length < 12) {
      curve = syntheticPrices(now, 48).map(s => ({ ts: s.ts, price: s.price_eur_mwh }));
    }
    setPrices(curve.map(c => {
      const d = new Date(c.ts);
      return { ts: c.ts, price: c.price, label: d.toLocaleString(undefined, { weekday: "short", hour: "2-digit" }) };
    }));
    const avg = curve.length ? curve.reduce((s, x) => s + x.price, 0) / curve.length : 70;
    setAvgWholesale(avg);

    // 30-day trend (avg daily wholesale)
    const monthAgo = new Date(Date.now() - 30 * 86400e3).toISOString();
    const { data: hist } = await supabase.from("market_prices")
      .select("delivery_at, price_eur_mwh")
      .gte("delivery_at", monthAgo)
      .order("delivery_at", { ascending: true });
    const byDay: Record<string, number[]> = {};
    (hist ?? []).forEach(r => {
      const d = (r.delivery_at as string).slice(0, 10);
      (byDay[d] ??= []).push(Number(r.price_eur_mwh));
    });
    setTrend(Object.entries(byDay).map(([day, arr]) => ({ day: day.slice(5), price: +(arr.reduce((s,x)=>s+x,0)/arr.length).toFixed(1) })));
  })(); }, [user]);

  const stats = useMemo(() => {
    if (!prices.length) return null;
    const sorted = [...prices].sort((a,b)=>a.price-b.price);
    const cheapest3 = sorted.slice(0, 3).sort((a,b)=>a.ts.localeCompare(b.ts));
    const current = prices[0];
    const min = sorted[0].price; const max = sorted[sorted.length-1].price;
    return { current, cheapest3, min, max };
  }, [prices]);

  const costFor = (p: (typeof PLANS)[number], kwh: number) => {
    const days = 30;
    const standing = p.standingEurDay * days;
    let energy = 0;
    if (typeof p.unitEurKwh === "function") {
      energy = p.unitEurKwh(avgWholesale) * kwh;
    } else if (p.nightShare && p.nightEurKwh != null) {
      energy = (p.unitEurKwh as number) * kwh * (1 - p.nightShare) + p.nightEurKwh * kwh * p.nightShare;
    } else {
      energy = (p.unitEurKwh as number) * kwh;
    }
    return +(standing + energy).toFixed(2);
  };

  const currentPlanObj = useMemo(() => {
    if (!currentTariff) return null;
    return PLANS.find(p => p.name === currentTariff) ?? null;
  }, [currentTariff]);

  const currentMonthlyCost = useMemo(() => currentPlanObj ? costFor(currentPlanObj, monthlyKwh) : null, [currentPlanObj, monthlyKwh, avgWholesale]);

  const switchTo = async (plan: Plan) => {
    if (!clientId) return toast.error("Account not linked");
    const { error } = await supabase.from("tariff_switch_requests").insert({
      client_id: clientId, target_tariff_code: plan.code, target_tariff_name: plan.name,
    } as any);
    if (error) return toast.error(error.message);
    setPendingCode(plan.code);
    setConfirmPlan(null);
    toast.success(`Switch to ${plan.name} requested — we'll process it within 2 working days.`);
  };

  return (
    <PortalLayout title="Tariffs & prices">
      {/* Current price + cheapest */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="md:col-span-1">
          <CardContent className="p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-2"><Zap className="h-3.5 w-3.5" style={{ color: EMBER }} /> Live wholesale price</div>
            <div className="mt-2 text-4xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: EMBER }}>
              {stats ? `€${stats.current.price.toFixed(0)}` : "—"}
              <span className="text-sm font-normal text-muted-foreground"> / MWh</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{currentTariff ? `You're on ${currentTariff}` : "No active tariff"}</div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" style={{ color: EMBER }} /> Cheapest slots in the next 48h</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 pt-0">
            {(stats?.cheapest3 ?? []).map(s => (
              <div key={s.ts} className="rounded-lg border border-border p-3" style={{ background: "rgba(34,197,94,0.08)" }}>
                <div className="text-[11px] text-muted-foreground">{new Date(s.ts).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}</div>
                <div className="text-lg font-semibold mt-0.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{new Date(s.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
                <div className="text-xs mt-1" style={{ color: "#22c55e" }}>€{s.price.toFixed(0)}/MWh</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 48h half-hourly chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Wholesale price — next 48 hours</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={prices} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
              <XAxis dataKey="label" fontSize={10} interval={5} stroke="hsl(var(--muted-foreground))" />
              <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "#1A140F", border: "1px solid #3A3128", borderRadius: 8, fontSize: 12 }}
                       formatter={(v: number) => [`€${Number(v).toFixed(1)}/MWh`, "Price"]}
                       labelFormatter={(_l, p) => p?.[0] ? new Date((p[0].payload as any).ts).toLocaleString() : ""} />
              <Bar dataKey="price" radius={[2,2,0,0]}>
                {stats && prices.map(p => <Cell key={p.ts} fill={colorFor(p.price, stats.min, stats.max)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 30-day trend */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">30-day trend (daily average)</CardTitle></CardHeader>
        <CardContent className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
              <XAxis dataKey="day" fontSize={10} stroke="hsl(var(--muted-foreground))" />
              <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "#1A140F", border: "1px solid #3A3128", borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="price" stroke={EMBER} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <div className="text-sm font-medium mb-2 flex items-center gap-2"><Sun className="h-4 w-4" style={{ color: EMBER }} /> Available plans</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PLANS.map(p => {
            const isPending = pendingCode === p.code;
            const Icon = p.icon;
            return (
              <Card key={p.code} className="relative overflow-hidden">
                {p.recommended && <div className="absolute top-3 right-3"><Badge style={{ background: EMBER, color: "#1A140F" }}>Recommended</Badge></div>}
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-md grid place-items-center" style={{ background: "rgba(255,107,44,0.12)", color: EMBER }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-widest text-muted-foreground">{p.tag}</div>
                      <div className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{p.name}</div>
                    </div>
                  </div>
                  <div className="text-sm">
                    <div><span className="text-muted-foreground">Unit:</span> {p.unit}</div>
                    <div><span className="text-muted-foreground">Standing charge:</span> {p.standing}</div>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {p.perks.map(perk => (
                      <li key={perk} className="flex items-center gap-2"><Check className="h-3.5 w-3.5" style={{ color: EMBER }} /> {perk}</li>
                    ))}
                  </ul>
                  <Button onClick={() => setConfirmPlan(p)} disabled={isPending} className="w-full"
                          style={isPending ? {} : { background: EMBER, color: "#1A140F" }}
                          variant={isPending ? "outline" : "default"}>
                    {isPending ? "Switch pending…" : (<>Compare & switch <ArrowRight className="h-4 w-4 ml-2" /></>)}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Confirm switch with monthly cost comparison */}
      <Dialog open={!!confirmPlan} onOpenChange={(o) => !o && setConfirmPlan(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Switch to {confirmPlan?.name}?
            </DialogTitle>
            <DialogDescription>
              Estimate based on your last 30 days of usage ({monthlyKwh.toLocaleString()} kWh) and an average wholesale price of €{avgWholesale.toFixed(0)}/MWh.
            </DialogDescription>
          </DialogHeader>

          {confirmPlan && (() => {
            const newCost = costFor(confirmPlan as any, monthlyKwh);
            const cur = currentMonthlyCost;
            const delta = cur != null ? +(newCost - cur).toFixed(2) : null;
            const annual = delta != null ? +(delta * 12).toFixed(0) : null;
            const cheaper = delta != null && delta < 0;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Current plan</div>
                    <div className="text-sm font-medium mt-1">{currentPlanObj?.name ?? currentTariff ?? "No active plan"}</div>
                    <div className="text-2xl font-semibold mt-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {cur != null ? `€${cur.toFixed(2)}` : "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">est. / month</div>
                  </div>
                  <div className="rounded-lg border p-3" style={{ borderColor: EMBER, background: "rgba(255,107,44,0.06)" }}>
                    <div className="text-[11px] uppercase tracking-widest" style={{ color: EMBER }}>New plan</div>
                    <div className="text-sm font-medium mt-1">{confirmPlan.name}</div>
                    <div className="text-2xl font-semibold mt-1" style={{ fontFamily: "'Space Grotesk', sans-serif", color: EMBER }}>
                      €{newCost.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">est. / month</div>
                  </div>
                </div>

                {delta != null && (
                  <div className="rounded-lg p-3 text-sm flex items-center justify-between"
                       style={{ background: cheaper ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
                                color: cheaper ? "#22c55e" : "#ef4444" }}>
                    <span>{cheaper ? "You could save" : "You could pay more"}</span>
                    <span className="font-semibold">
                      €{Math.abs(delta).toFixed(2)} / month · €{Math.abs(annual!).toLocaleString()} / year
                    </span>
                  </div>
                )}

                <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-3">
                  <div><span className="text-foreground">Unit rate:</span> {confirmPlan.unit}</div>
                  <div><span className="text-foreground">Standing charge:</span> {confirmPlan.standing}</div>
                  <div>Estimates are indicative. Your actual bill depends on real usage, daily wholesale prices, and when you use power.</div>
                </div>
              </div>
            );
          })()}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmPlan(null)}>Cancel</Button>
            <Button onClick={() => confirmPlan && switchTo(confirmPlan)}
                    style={{ background: EMBER, color: "#1A140F" }}>
              Confirm switch <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}