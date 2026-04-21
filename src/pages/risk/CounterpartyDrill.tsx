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
import { fmtEur, fmtNum } from "@/lib/format";
import { ArrowLeft, Wallet, TrendingUp, FileSignature, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { format, subDays } from "date-fns";

type Cp = { id: string; legal_name: string; short_name: string|null; eic_code: string|null; country_code: string|null; credit_limit_eur: number; risk_status: string; payment_terms_days: number };
type Trade = { id: string; trade_number: string; side: string; status: string; market: string; volume_mwh: number; price_eur_mwh: number; total_value_eur: number|null; delivery_start: string; delivery_end: string; created_at: string };
type Tc = { id: string; contract_number: string; contract_type: string; status: string; start_date: string; end_date: string|null };

export default function CounterpartyDrill() {
  const { id } = useParams<{ id: string }>();
  const [cp, setCp] = useState<Cp | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [contracts, setContracts] = useState<Tc[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [cR, tR, tcR] = await Promise.all([
        supabase.from("counterparties").select("*").eq("id", id).maybeSingle(),
        supabase.from("trades").select("id,trade_number,side,status,market,volume_mwh,price_eur_mwh,total_value_eur,delivery_start,delivery_end,created_at").eq("counterparty_id", id).order("created_at", { ascending: false }),
        supabase.from("trading_contracts").select("id,contract_number,contract_type,status,start_date,end_date").eq("counterparty_id", id),
      ]);
      setCp((cR.data as any) ?? null);
      setTrades((tR.data as any) ?? []);
      setContracts((tcR.data as any) ?? []);
    })();
  }, [id]);

  const stats = useMemo(() => {
    let buy = 0, sell = 0, pipeline = 0, settled = 0;
    for (const t of trades) {
      const n = Number(t.total_value_eur ?? Number(t.volume_mwh) * Number(t.price_eur_mwh));
      if (t.status === "confirmed" || t.status === "nominated") {
        if (t.side === "buy") buy += n; else sell += n;
      } else if (t.status === "draft") pipeline += n;
      else if (t.status === "settled") settled += n;
    }
    const net = Math.abs(buy - sell);
    const limit = Number(cp?.credit_limit_eur ?? 0);
    const util = limit > 0 ? Math.min(100, (net / limit) * 100) : 0;
    return { buy, sell, net, pipeline, settled, util };
  }, [trades, cp]);

  // 90-day exposure trend (cumulative confirmed notional by trade creation date)
  const trend = useMemo(() => {
    const days: { date: string; exposure: number }[] = [];
    for (let i = 89; i >= 0; i--) {
      const day = subDays(new Date(), i);
      day.setHours(23, 59, 59, 999);
      let buy = 0, sell = 0;
      for (const t of trades) {
        if (t.status !== "confirmed" && t.status !== "nominated") continue;
        if (new Date(t.created_at) > day) continue;
        const n = Number(t.total_value_eur ?? Number(t.volume_mwh) * Number(t.price_eur_mwh));
        if (t.side === "buy") buy += n; else sell += n;
      }
      days.push({ date: format(day, "MM-dd"), exposure: Math.abs(buy - sell) });
    }
    return days;
  }, [trades]);

  return (
    <ErpLayout title={cp?.legal_name ?? "Counterparty"} subtitle={cp ? `${cp.eic_code ?? "no EIC"} · ${cp.country_code ?? "—"} · payment terms ${cp.payment_terms_days}d` : "Loading…"}
      actions={<Button asChild variant="outline" size="sm"><Link to="/risk"><ArrowLeft className="h-3 w-3 mr-1" />Back to Risk</Link></Button>}>
      <RoleGate roles={["risk_officer", "management", "admin"]}>
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Net Exposure" value={fmtEur(stats.net)} icon={Wallet} accent="primary" hint={`${fmtNum(stats.util, 0)}% of limit`} />
            <StatCard label="Confirmed Buy" value={fmtEur(stats.buy)} icon={TrendingUp} accent="accent" />
            <StatCard label="Confirmed Sell" value={fmtEur(stats.sell)} icon={TrendingUp} accent="warning" />
            <StatCard label="Pipeline (Draft)" value={fmtEur(stats.pipeline)} icon={Activity} hint="Not yet confirmed" />
          </div>

          <Card className="border-border/60">
            <CardHeader><CardTitle>90-day exposure trend (€)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} interval={6} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Line type="monotone" dataKey="exposure" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader><CardTitle className="flex items-center gap-2"><FileSignature className="h-4 w-4" />Trading contracts ({contracts.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Type</TableHead><TableHead>Validity</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {contracts.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.contract_number}</TableCell>
                      <TableCell className="capitalize">{c.contract_type}</TableCell>
                      <TableCell className="text-xs">{c.start_date} → {c.end_date ?? "open"}</TableCell>
                      <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {contracts.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-sm text-muted-foreground">No contracts.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader><CardTitle>Trades ({trades.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Number</TableHead><TableHead>Side</TableHead><TableHead>Market</TableHead>
                  <TableHead>Delivery</TableHead><TableHead className="text-right">MWh</TableHead>
                  <TableHead className="text-right">€/MWh</TableHead><TableHead className="text-right">Notional</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {trades.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.trade_number}</TableCell>
                      <TableCell><Badge variant="outline" className={t.side === "buy" ? "border-accent/30 text-accent" : "border-destructive/30 text-destructive"}>{t.side}</Badge></TableCell>
                      <TableCell className="capitalize text-xs">{t.market.replace("_", " ")}</TableCell>
                      <TableCell className="text-xs">{format(new Date(t.delivery_start), "MM-dd HH:mm")} → {format(new Date(t.delivery_end), "MM-dd HH:mm")}</TableCell>
                      <TableCell className="text-right font-mono">{fmtNum(t.volume_mwh)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtNum(t.price_eur_mwh)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtEur(Number(t.total_value_eur ?? Number(t.volume_mwh) * Number(t.price_eur_mwh)))}</TableCell>
                      <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {trades.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-6 text-sm text-muted-foreground">No trades.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </RoleGate>
    </ErpLayout>
  );
}