import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { StatCard } from "@/components/erp/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Legend } from "recharts";
import { format } from "date-fns";

type Trade = { id: string; trade_number: string; counterparty_id: string|null; side: string; status: string; market: string; volume_mwh: number; delivery_start: string; delivery_end: string };
type SchLine = { id: string; schedule_id: string; hour: number; volume_mwh: number; direction: string };
type Sch = { id: string; schedule_number: string; tso_area: string; delivery_date: string; status: string };
type Cp = { id: string; legal_name: string };

export default function NopDrill() {
  const { date } = useParams<{ date: string }>();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [schedules, setSchedules] = useState<Sch[]>([]);
  const [lines, setLines] = useState<SchLine[]>([]);
  const [cps, setCps] = useState<Cp[]>([]);

  useEffect(() => {
    if (!date) return;
    (async () => {
      const dayStart = new Date(`${date}T00:00:00.000Z`).toISOString();
      const dayEnd = new Date(`${date}T23:59:59.999Z`).toISOString();
      const [tR, sR, cpR] = await Promise.all([
        supabase.from("trades").select("id,trade_number,counterparty_id,side,status,market,volume_mwh,delivery_start,delivery_end")
          .lte("delivery_start", dayEnd).gte("delivery_end", dayStart).neq("status", "cancelled"),
        supabase.from("schedules").select("id,schedule_number,tso_area,delivery_date,status").eq("delivery_date", date),
        supabase.from("counterparties").select("id,legal_name"),
      ]);
      setTrades((tR.data as any) ?? []);
      setSchedules((sR.data as any) ?? []);
      setCps((cpR.data as any) ?? []);
      const sids = ((sR.data as any) ?? []).map((s: Sch) => s.id);
      if (sids.length > 0) {
        const { data } = await supabase.from("schedule_lines").select("*").in("schedule_id", sids).order("hour");
        setLines((data as any) ?? []);
      }
    })();
  }, [date]);

  const cpMap = useMemo(() => new Map(cps.map(c => [c.id, c.legal_name])), [cps]);

  // Hourly buy/sell - prefer schedule_lines; otherwise spread trade volume
  const hourly = useMemo(() => {
    if (!date) return [];
    const arr = Array.from({ length: 24 }, (_, h) => ({ hour: `H${String(h).padStart(2, "0")}`, h, buy: 0, sell: 0, net: 0 }));
    if (lines.length > 0) {
      for (const l of lines) {
        if (l.direction === "in") arr[l.hour].buy += Number(l.volume_mwh);
        else arr[l.hour].sell += Number(l.volume_mwh);
      }
    } else {
      const dayStart = new Date(`${date}T00:00:00`); const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      for (const t of trades) {
        const ts = new Date(t.delivery_start), te = new Date(t.delivery_end);
        const start = new Date(Math.max(ts.getTime(), dayStart.getTime()));
        const end = new Date(Math.min(te.getTime(), dayEnd.getTime()));
        const totalH = Math.max(1, (te.getTime() - ts.getTime()) / 3600_000);
        const perHour = Number(t.volume_mwh) / totalH;
        const startH = start.getHours();
        const hours = Math.max(1, Math.round((end.getTime() - start.getTime()) / 3600_000));
        for (let i = 0; i < hours; i++) {
          const h = (startH + i) % 24;
          if (t.side === "buy") arr[h].buy += perHour; else arr[h].sell += perHour;
        }
      }
    }
    arr.forEach(r => { r.net = +(r.buy - r.sell).toFixed(2); r.buy = +r.buy.toFixed(2); r.sell = +r.sell.toFixed(2); });
    return arr;
  }, [trades, lines, date]);

  const totals = hourly.reduce((s, r) => ({ buy: s.buy + r.buy, sell: s.sell + r.sell }), { buy: 0, sell: 0 });
  const peakBuy = Math.max(0, ...hourly.map(r => r.buy));
  const peakSell = Math.max(0, ...hourly.map(r => r.sell));

  return (
    <ErpLayout title={`Net Open Position — ${date}`} subtitle={`${trades.length} contributing trade(s) · ${schedules.length} schedule(s) · source: ${lines.length > 0 ? "scheduled" : "estimated"}`}
      actions={<Button asChild variant="outline" size="sm"><Link to="/risk"><ArrowLeft className="h-3 w-3 mr-1" />Back to Risk</Link></Button>}>
      <RoleGate roles={["risk_officer", "management", "admin", "trader"]}>
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Total Buy (MWh)" value={fmtNum(totals.buy)} icon={TrendingUp} accent="accent" />
            <StatCard label="Total Sell (MWh)" value={fmtNum(totals.sell)} icon={TrendingUp} accent="warning" />
            <StatCard label="Net (MWh)" value={fmtNum(totals.buy - totals.sell)} icon={TrendingUp} accent="primary" />
            <StatCard label="Peak Hour" value={`${fmtNum(Math.max(peakBuy, peakSell))} MWh`} icon={TrendingUp} hint={`Buy ${fmtNum(peakBuy)} · Sell ${fmtNum(peakSell)}`} />
          </div>

          <Card className="border-border/60">
            <CardHeader><CardTitle>Hourly buy/sell breakdown</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                  <Bar dataKey="buy" fill="hsl(var(--accent))" name="Buy" />
                  <Bar dataKey="sell" fill="hsl(var(--destructive))" name="Sell" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader><CardTitle>Contributing trades ({trades.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Trade #</TableHead><TableHead>Counterparty</TableHead><TableHead>Side</TableHead>
                  <TableHead>Market</TableHead><TableHead>Window</TableHead>
                  <TableHead className="text-right">MWh</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {trades.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.trade_number}</TableCell>
                      <TableCell>{t.counterparty_id ? cpMap.get(t.counterparty_id) ?? "—" : "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={t.side === "buy" ? "border-accent/30 text-accent" : "border-destructive/30 text-destructive"}>{t.side}</Badge></TableCell>
                      <TableCell className="capitalize text-xs">{t.market.replace("_", " ")}</TableCell>
                      <TableCell className="text-xs">{format(new Date(t.delivery_start), "MM-dd HH:mm")} → {format(new Date(t.delivery_end), "MM-dd HH:mm")}</TableCell>
                      <TableCell className="text-right font-mono">{fmtNum(t.volume_mwh)}</TableCell>
                      <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {trades.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">No trades on this day.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </RoleGate>
    </ErpLayout>
  );
}