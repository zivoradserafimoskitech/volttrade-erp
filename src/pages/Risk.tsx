import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { StatCard } from "@/components/erp/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { fmtEur, fmtNum } from "@/lib/format";
import { AlertTriangle, TrendingUp, Wallet, Activity, Clock, Layers } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

type Cp = { id: string; legal_name: string; credit_limit_eur: number; risk_status: string };
type Trade = { id: string; counterparty_id: string|null; side: string; status: string; market: string; volume_mwh: number; price_eur_mwh: number; total_value_eur: number|null; delivery_start: string; delivery_end: string };
type Inv = { id: string; client_id: string; total_eur: number; paid_amount_eur: number; due_date: string|null; status: string };

function bucketLabel(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

export default function Risk() {
  const [cps, setCps] = useState<Cp[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [invoices, setInvoices] = useState<Inv[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: t }, { data: i }] = await Promise.all([
        supabase.from("counterparties").select("id,legal_name,credit_limit_eur,risk_status"),
        supabase.from("trades").select("id,counterparty_id,side,status,market,volume_mwh,price_eur_mwh,total_value_eur,delivery_start,delivery_end").limit(1000),
        supabase.from("invoices").select("id,client_id,total_eur,paid_amount_eur,due_date,status").limit(1000),
      ]);
      setCps((c as any) ?? []);
      setTrades((t as any) ?? []);
      setInvoices((i as any) ?? []);
    })();
  }, []);

  // Counterparty exposure
  const exposure = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of trades) {
      if (!t.counterparty_id) continue;
      if (t.status !== "confirmed" && t.status !== "nominated") continue;
      const notional = Number(t.total_value_eur ?? Number(t.volume_mwh) * Number(t.price_eur_mwh));
      map.set(t.counterparty_id, (map.get(t.counterparty_id) ?? 0) + notional);
    }
    return cps
      .map(c => ({
        ...c,
        exposure: map.get(c.id) ?? 0,
        utilization: c.credit_limit_eur > 0 ? Math.min(100, ((map.get(c.id) ?? 0) / Number(c.credit_limit_eur)) * 100) : 0,
      }))
      .sort((a, b) => b.exposure - a.exposure);
  }, [cps, trades]);

  const totalExposure = exposure.reduce((s, e) => s + e.exposure, 0);
  const overLimit = exposure.filter(e => e.utilization >= 80);

  // Aging
  const aging = useMemo(() => {
    const buckets: Record<string, { count: number; total: number }> = {
      Current: { count: 0, total: 0 }, "1-30": { count: 0, total: 0 }, "31-60": { count: 0, total: 0 }, "61-90": { count: 0, total: 0 }, "90+": { count: 0, total: 0 },
    };
    const today = new Date();
    let totalOverdue = 0; let dsoSum = 0; let dsoCnt = 0;
    for (const inv of invoices) {
      const out = Number(inv.total_eur) - Number(inv.paid_amount_eur);
      if (out <= 0.01 || inv.status === "cancelled") continue;
      const due = inv.due_date ? new Date(inv.due_date) : today;
      const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
      const b = bucketLabel(days);
      buckets[b].count++; buckets[b].total += out;
      if (days > 0) totalOverdue += out;
      dsoSum += Math.max(0, days); dsoCnt++;
    }
    return { buckets, totalOverdue, avgDso: dsoCnt > 0 ? dsoSum / dsoCnt : 0 };
  }, [invoices]);

  // Net Open Position next 14 days
  const nop = useMemo(() => {
    const days: { date: string; buy: number; sell: number; net: number }[] = [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    for (let d = 0; d < 14; d++) {
      const day = new Date(start.getTime() + d * 86_400_000);
      const dayStr = day.toISOString().slice(5, 10);
      const dayEnd = new Date(day.getTime() + 86_400_000);
      let buy = 0, sell = 0;
      for (const t of trades) {
        if (t.status === "cancelled") continue;
        const ts = new Date(t.delivery_start), te = new Date(t.delivery_end);
        if (te <= day || ts >= dayEnd) continue;
        const overlapH = Math.max(0, (Math.min(te.getTime(), dayEnd.getTime()) - Math.max(ts.getTime(), day.getTime())) / 3600_000);
        const totalH = Math.max(1, (te.getTime() - ts.getTime()) / 3600_000);
        const v = Number(t.volume_mwh) * (overlapH / totalH);
        if (t.side === "buy") buy += v; else sell += v;
      }
      days.push({ date: dayStr, buy: Number(buy.toFixed(2)), sell: Number(sell.toFixed(2)), net: Number((buy - sell).toFixed(2)) });
    }
    return days;
  }, [trades]);

  // Unsettled trades by market
  const unsettled = useMemo(() => {
    const map = new Map<string, { count: number; notional: number }>();
    for (const t of trades) {
      if (t.status === "settled" || t.status === "cancelled") continue;
      const cur = map.get(t.market) ?? { count: 0, notional: 0 };
      cur.count++;
      cur.notional += Number(t.total_value_eur ?? Number(t.volume_mwh) * Number(t.price_eur_mwh));
      map.set(t.market, cur);
    }
    return Array.from(map.entries()).map(([market, v]) => ({ market, ...v })).sort((a, b) => b.notional - a.notional);
  }, [trades]);

  const openTrades = trades.filter(t => t.status !== "settled" && t.status !== "cancelled").length;

  // Concentration top 5
  const concentration = exposure.slice(0, 5).map(e => ({ ...e, share: totalExposure > 0 ? (e.exposure / totalExposure) * 100 : 0 }));

  return (
    <ErpLayout title="Risk & Exposure" subtitle="Counterparty exposure, debt aging, net open position, concentration">
      <RoleGate roles={["risk_officer", "management", "admin"]}>
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Total Exposure" value={fmtEur(totalExposure)} icon={Wallet} accent="primary" hint={`${exposure.length} counterparties`} />
            <StatCard label="Overdue" value={fmtEur(aging.totalOverdue)} icon={AlertTriangle} accent="destructive" hint={`Avg DSO: ${fmtNum(aging.avgDso, 0)} days`} />
            <StatCard label="Open Trades" value={String(openTrades)} icon={Activity} accent="accent" hint="Not yet settled" />
            <StatCard label="Limit Alerts" value={String(overLimit.length)} icon={TrendingUp} accent="warning" hint="≥ 80% utilization" />
          </div>

          {/* Counterparty exposure */}
          <Card className="border-border/60">
            <CardHeader><CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" />Counterparty exposure vs credit limit</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Counterparty</TableHead><TableHead className="text-right">Exposure</TableHead>
                  <TableHead className="text-right">Credit limit</TableHead><TableHead>Utilization</TableHead><TableHead>Risk</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {exposure.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.legal_name}</TableCell>
                      <TableCell className="text-right font-mono">{fmtEur(e.exposure)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{fmtEur(e.credit_limit_eur)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[160px]">
                          <Progress value={e.utilization} className="h-2" />
                          <span className={`text-xs font-mono w-12 text-right ${e.utilization >= 80 ? "text-destructive" : "text-muted-foreground"}`}>{fmtNum(e.utilization, 0)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={
                          e.utilization >= 100 ? "bg-destructive/20 text-destructive border-destructive/30"
                          : e.utilization >= 80 ? "bg-warning/20 text-warning border-warning/30"
                          : "bg-accent/20 text-accent border-accent/30"
                        }>
                          {e.utilization >= 100 ? "Over limit" : e.utilization >= 80 ? "Warning" : e.risk_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {exposure.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm text-muted-foreground">No counterparties yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* NOP chart */}
            <Card className="border-border/60">
              <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" />Net Open Position — next 14 days (MWh)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={nop}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <Bar dataKey="net" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Aging */}
            <Card className="border-border/60">
              <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" />Customer debt aging</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Bucket (days overdue)</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {Object.entries(aging.buckets).map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell>
                          <Badge variant="outline" className={
                            k === "Current" ? "border-accent/30 text-accent"
                            : k === "90+" ? "border-destructive/30 text-destructive"
                            : k === "61-90" ? "border-warning/30 text-warning"
                            : "border-border"
                          }>{k}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{v.count}</TableCell>
                        <TableCell className="text-right font-mono">{fmtEur(v.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Unsettled */}
            <Card className="border-border/60">
              <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" />Unsettled trades by market</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Market</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Notional</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {unsettled.map(u => (
                      <TableRow key={u.market}>
                        <TableCell className="capitalize">{u.market.replace("_", " ")}</TableCell>
                        <TableCell className="text-right font-mono">{u.count}</TableCell>
                        <TableCell className="text-right font-mono">{fmtEur(u.notional)}</TableCell>
                      </TableRow>
                    ))}
                    {unsettled.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-6 text-sm text-muted-foreground">No open trades.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Concentration */}
            <Card className="border-border/60">
              <CardHeader><CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" />Concentration risk — top 5</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {concentration.map(c => (
                  <div key={c.id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="truncate">{c.legal_name}</span>
                      <span className="font-mono text-muted-foreground">{fmtNum(c.share, 1)}%</span>
                    </div>
                    <Progress value={c.share} className="h-2" />
                  </div>
                ))}
                {concentration.length === 0 && <div className="text-center py-6 text-sm text-muted-foreground">No exposure data yet.</div>}
              </CardContent>
            </Card>
          </div>
        </div>
      </RoleGate>
    </ErpLayout>
  );
}