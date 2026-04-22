import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { StatCard } from "@/components/erp/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { fmtEur, fmtNum } from "@/lib/format";
import { exportToExcel, exportToPdf } from "@/lib/exports";
import { AlertTriangle, TrendingUp, Wallet, Activity, Clock, Layers, RefreshCw, Download, FileSpreadsheet, FileText, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Line, ComposedChart, Legend } from "recharts";
import { format } from "date-fns";

type Cp = { id: string; legal_name: string; credit_limit_eur: number; risk_status: string };
type Trade = { id: string; counterparty_id: string|null; side: string; status: string; market: string; volume_mwh: number; price_eur_mwh: number; total_value_eur: number|null; delivery_start: string; delivery_end: string };
type Inv = { id: string; client_id: string; total_eur: number; paid_amount_eur: number; due_date: string|null; status: string; period_end: string };
type Client = { id: string; payment_terms_days: number };
type SchLine = { schedule_id: string; hour: number; volume_mwh: number; direction: string };
type Sch = { id: string; delivery_date: string; status: string };

function bucketLabel(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

const REFRESH_INTERVALS = { off: 0, "15s": 15_000, "30s": 30_000, "1m": 60_000, "5m": 300_000 } as const;
type IntervalKey = keyof typeof REFRESH_INTERVALS;

export default function Risk() {
  const [cps, setCps] = useState<Cp[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [schedules, setSchedules] = useState<Sch[]>([]);
  const [schLines, setSchLines] = useState<SchLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [tick, setTick] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [interval, setIntervalKey] = useState<IntervalKey>("30s");
  const intervalRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cR, tR, iR, clR, sR, slR] = await Promise.all([
      supabase.from("counterparties").select("id,legal_name,credit_limit_eur,risk_status"),
      supabase.from("trades").select("id,counterparty_id,side,status,market,volume_mwh,price_eur_mwh,total_value_eur,delivery_start,delivery_end").limit(1000),
      supabase.from("invoices").select("id,client_id,total_eur,paid_amount_eur,due_date,status,period_end").limit(1000),
      supabase.from("clients").select("id,payment_terms_days"),
      supabase.from("schedules").select("id,delivery_date,status").gte("delivery_date", new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)),
      supabase.from("schedule_lines").select("schedule_id,hour,volume_mwh,direction"),
    ]);
    setCps((cR.data as any) ?? []);
    setTrades((tR.data as any) ?? []);
    setInvoices((iR.data as any) ?? []);
    setClients((clR.data as any) ?? []);
    setSchedules((sR.data as any) ?? []);
    setSchLines((slR.data as any) ?? []);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (autoRefresh && REFRESH_INTERVALS[interval] > 0) {
      intervalRef.current = window.setInterval(load, REFRESH_INTERVALS[interval]);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, interval, load]);

  // "Last updated" tick
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Realtime subscriptions
  useEffect(() => {
    const ch = supabase.channel("risk-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "counterparties" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // ─── Counterparty exposure (improved: net buy-sell + draft pipeline) ───
  const exposure = useMemo(() => {
    const conf = new Map<string, { buy: number; sell: number }>();
    const pipe = new Map<string, number>();
    for (const t of trades) {
      if (!t.counterparty_id) continue;
      const notional = Number(t.total_value_eur ?? Number(t.volume_mwh) * Number(t.price_eur_mwh));
      if (t.status === "confirmed" || t.status === "nominated") {
        const cur = conf.get(t.counterparty_id) ?? { buy: 0, sell: 0 };
        if (t.side === "buy") cur.buy += notional; else cur.sell += notional;
        conf.set(t.counterparty_id, cur);
      } else if (t.status === "draft") {
        pipe.set(t.counterparty_id, (pipe.get(t.counterparty_id) ?? 0) + notional);
      }
    }
    return cps.map(c => {
      const x = conf.get(c.id) ?? { buy: 0, sell: 0 };
      const net = Math.abs(x.buy - x.sell);
      const gross = x.buy + x.sell;
      const pipeline = pipe.get(c.id) ?? 0;
      const limit = Number(c.credit_limit_eur);
      const utilization = limit > 0 ? Math.min(100, (net / limit) * 100) : 0;
      return { ...c, net_exposure: net, gross_exposure: gross, buy: x.buy, sell: x.sell, pipeline, utilization };
    }).sort((a, b) => b.net_exposure - a.net_exposure);
  }, [cps, trades]);

  const totalExposure = exposure.reduce((s, e) => s + e.net_exposure, 0);
  const overLimit = exposure.filter(e => e.utilization >= 80);
  // HHI on share of exposure (0-10000)
  const hhi = useMemo(() => {
    if (totalExposure === 0) return 0;
    return Math.round(exposure.reduce((s, e) => s + Math.pow((e.net_exposure / totalExposure) * 100, 2), 0));
  }, [exposure, totalExposure]);

  // ─── Aging (improved: effective due date, weighted DSO, skip cancelled) ───
  const clientTerms = useMemo(() => new Map(clients.map(c => [c.id, c.payment_terms_days])), [clients]);
  const aging = useMemo(() => {
    const buckets: Record<string, { count: number; total: number }> = {
      Current: { count: 0, total: 0 }, "1-30": { count: 0, total: 0 }, "31-60": { count: 0, total: 0 }, "61-90": { count: 0, total: 0 }, "90+": { count: 0, total: 0 },
    };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let totalOverdue = 0;
    let weightedDsoNum = 0; let weightedDsoDen = 0;
    for (const inv of invoices) {
      if (inv.status === "cancelled" || inv.status === "draft") continue;
      const out = Number(inv.total_eur) - Number(inv.paid_amount_eur);
      if (out <= 0.01) continue;
      let due: Date;
      if (inv.due_date) due = new Date(inv.due_date);
      else {
        const terms = clientTerms.get(inv.client_id) ?? 14;
        due = new Date(inv.period_end);
        due.setDate(due.getDate() + terms);
      }
      const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
      const b = bucketLabel(days);
      buckets[b].count++; buckets[b].total += out;
      if (days > 0) totalOverdue += out;
      weightedDsoNum += Math.max(0, days) * out;
      weightedDsoDen += out;
    }
    return { buckets, totalOverdue, avgDso: weightedDsoDen > 0 ? weightedDsoNum / weightedDsoDen : 0 };
  }, [invoices, clientTerms]);

  // ─── NOP (improved: use schedule_lines when available) ───
  const nop = useMemo(() => {
    const days: { date: string; iso: string; buy: number; sell: number; net: number; source: "scheduled" | "estimated" }[] = [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    // Build map: schedule_id -> total signed volume per day
    const schByDate = new Map<string, { in: number; out: number }>();
    for (const s of schedules) {
      const lines = schLines.filter(l => l.schedule_id === s.id);
      const totals = lines.reduce((acc, l) => {
        if (l.direction === "in") acc.in += Number(l.volume_mwh); else acc.out += Number(l.volume_mwh);
        return acc;
      }, { in: 0, out: 0 });
      const cur = schByDate.get(s.delivery_date) ?? { in: 0, out: 0 };
      schByDate.set(s.delivery_date, { in: cur.in + totals.in, out: cur.out + totals.out });
    }
    for (let d = 0; d < 14; d++) {
      const day = new Date(start.getTime() + d * 86_400_000);
      const iso = day.toISOString().slice(0, 10);
      const dayStr = day.toISOString().slice(5, 10);
      const sched = schByDate.get(iso);
      let buy = 0, sell = 0; let source: "scheduled" | "estimated" = "estimated";
      if (sched && (sched.in > 0 || sched.out > 0)) {
        buy = sched.in; sell = sched.out; source = "scheduled";
      } else {
        const dayEnd = new Date(day.getTime() + 86_400_000);
        for (const t of trades) {
          if (t.status === "cancelled") continue;
          const ts = new Date(t.delivery_start), te = new Date(t.delivery_end);
          if (te <= day || ts >= dayEnd) continue;
          const overlapH = Math.max(0, (Math.min(te.getTime(), dayEnd.getTime()) - Math.max(ts.getTime(), day.getTime())) / 3600_000);
          const totalH = Math.max(1, (te.getTime() - ts.getTime()) / 3600_000);
          const v = Number(t.volume_mwh) * (overlapH / totalH);
          if (t.side === "buy") buy += v; else sell += v;
        }
      }
      days.push({ date: dayStr, iso, buy: +buy.toFixed(2), sell: +sell.toFixed(2), net: +(buy - sell).toFixed(2), source });
    }
    return days;
  }, [trades, schedules, schLines]);

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
  const concentration = exposure.slice(0, 5).map(e => ({ ...e, share: totalExposure > 0 ? (e.net_exposure / totalExposure) * 100 : 0 }));

  // ─── Exports ───
  const stamp = format(new Date(), "yyyy-MM-dd_HHmm");
  const exportExposure = (kind: "xlsx" | "pdf") => {
    const cols = [
      { key: "legal_name", label: "Counterparty", format: "text" as const },
      { key: "net_exposure", label: "Net Exposure (€)", format: "eur" as const },
      { key: "gross_exposure", label: "Gross (€)", format: "eur" as const },
      { key: "pipeline", label: "Pipeline (€)", format: "eur" as const },
      { key: "credit_limit_eur", label: "Credit Limit (€)", format: "eur" as const },
      { key: "utilization", label: "Utilization", format: "pct" as const },
      { key: "risk_status", label: "Risk", format: "text" as const },
    ];
    const totals = { legal_name: "TOTAL", net_exposure: totalExposure, gross_exposure: exposure.reduce((s, e) => s + e.gross_exposure, 0), pipeline: exposure.reduce((s, e) => s + e.pipeline, 0), credit_limit_eur: exposure.reduce((s, e) => s + Number(e.credit_limit_eur), 0) };
    if (kind === "xlsx") exportToExcel(`risk_exposure_${stamp}`, [{ name: "Counterparty Exposure", columns: cols, rows: exposure }]);
    else exportToPdf({ title: "Counterparty Exposure", subtitle: `${exposure.length} counterparties`, filename: `risk_exposure_${stamp}`, sections: [{ heading: "Net exposure vs credit limit", columns: cols, rows: exposure, totals }] });
  };

  const exportNop = (kind: "xlsx" | "pdf") => {
    const cols = [
      { key: "iso", label: "Date", format: "text" as const },
      { key: "buy", label: "Buy (MWh)", format: "num" as const },
      { key: "sell", label: "Sell (MWh)", format: "num" as const },
      { key: "net", label: "Net (MWh)", format: "num" as const },
      { key: "source", label: "Source", format: "text" as const },
    ];
    if (kind === "xlsx") exportToExcel(`risk_nop_${stamp}`, [{ name: "Net Open Position 14d", columns: cols, rows: nop }]);
    else exportToPdf({ title: "Net Open Position — 14 days", filename: `risk_nop_${stamp}`, sections: [{ heading: "Daily NOP", columns: cols, rows: nop }] });
  };

  const exportAging = (kind: "xlsx" | "pdf") => {
    const cols = [
      { key: "bucket", label: "Bucket", format: "text" as const },
      { key: "count", label: "Invoices", format: "num" as const },
      { key: "total", label: "Outstanding (€)", format: "eur" as const },
    ];
    const rows = Object.entries(aging.buckets).map(([k, v]) => ({ bucket: k, count: v.count, total: v.total }));
    const totals = { bucket: "TOTAL", count: rows.reduce((s, r) => s + r.count, 0), total: rows.reduce((s, r) => s + r.total, 0) };
    if (kind === "xlsx") exportToExcel(`risk_aging_${stamp}`, [{ name: "Debt Aging", columns: cols, rows }]);
    else exportToPdf({ title: "Customer Debt Aging", filename: `risk_aging_${stamp}`, sections: [{ heading: "Outstanding by aging bucket", columns: cols, rows, totals }] });
  };

  const exportFullReport = () => {
    const expCols = [
      { key: "legal_name", label: "Counterparty", format: "text" as const },
      { key: "net_exposure", label: "Net (€)", format: "eur" as const },
      { key: "credit_limit_eur", label: "Limit (€)", format: "eur" as const },
      { key: "utilization", label: "Util.", format: "pct" as const },
    ];
    const nopCols = [
      { key: "iso", label: "Date", format: "text" as const },
      { key: "buy", label: "Buy (MWh)", format: "num" as const },
      { key: "sell", label: "Sell (MWh)", format: "num" as const },
      { key: "net", label: "Net (MWh)", format: "num" as const },
    ];
    const ageCols = [
      { key: "bucket", label: "Bucket", format: "text" as const },
      { key: "count", label: "Invoices", format: "num" as const },
      { key: "total", label: "Outstanding (€)", format: "eur" as const },
    ];
    const ageRows = Object.entries(aging.buckets).map(([k, v]) => ({ bucket: k, count: v.count, total: v.total }));
    exportToPdf({
      title: "Full Risk & Exposure Report",
      subtitle: `Total exposure ${fmtEur(totalExposure)} · Overdue ${fmtEur(aging.totalOverdue)}`,
      filename: `risk_full_report_${stamp}`,
      sections: [
        { heading: "1. Counterparty exposure", columns: expCols, rows: exposure, totals: { legal_name: "TOTAL", net_exposure: totalExposure, credit_limit_eur: exposure.reduce((s, e) => s + Number(e.credit_limit_eur), 0) } },
        { heading: "2. Net Open Position — next 14 days", columns: nopCols, rows: nop },
        { heading: "3. Customer debt aging", columns: ageCols, rows: ageRows, totals: { bucket: "TOTAL", count: ageRows.reduce((s, r) => s + r.count, 0), total: ageRows.reduce((s, r) => s + r.total, 0) } },
      ],
    });
  };

  // Last updated humanized
  const secondsAgo = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
  // referenced to keep `tick` in deps for re-render
  void tick;

  const ExportMenu = ({ onExcel, onPdf, label }: { onExcel: () => void; onPdf: () => void; label: string }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Export ${label}`}><Download className="h-3 w-3 mr-1" />Export</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onExcel}><FileSpreadsheet className="h-4 w-4 mr-2" />Excel (.xlsx)</DropdownMenuItem>
        <DropdownMenuItem onClick={onPdf}><FileText className="h-4 w-4 mr-2" />PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ErpLayout
      title="Risk & Exposure"
      subtitle="Counterparty exposure, debt aging, net open position, concentration"
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden md:inline">Updated {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`}</span>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <div className="hidden md:flex items-center gap-2 border border-border rounded-md px-2 py-1">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Auto-refresh" />
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {autoRefresh && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />}
              Auto
            </span>
            <Select value={interval} onValueChange={(v) => setIntervalKey(v as IntervalKey)}>
              <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15s">15s</SelectItem>
                <SelectItem value="30s">30s</SelectItem>
                <SelectItem value="1m">1m</SelectItem>
                <SelectItem value="5m">5m</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={exportFullReport} style={{ background: "var(--gradient-primary)" }}>
            <FileText className="h-3 w-3 mr-1" /> Full report
          </Button>
        </div>
      }
    >
      <RoleGate roles={["risk_officer", "management", "admin"]}>
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Total Net Exposure" value={fmtEur(totalExposure)} icon={Wallet} accent="primary" hint={`${exposure.length} counterparties · HHI ${hhi}`} />
            <StatCard label="Overdue" value={fmtEur(aging.totalOverdue)} icon={AlertTriangle} accent="destructive" hint={`Weighted DSO: ${fmtNum(aging.avgDso, 0)} days`} />
            <StatCard label="Open Trades" value={String(openTrades)} icon={Activity} accent="accent" hint="Not yet settled" />
            <StatCard label="Limit Alerts" value={String(overLimit.length)} icon={TrendingUp} accent="warning" hint="≥ 80% utilization" />
          </div>

          {/* Counterparty exposure */}
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" />Counterparty exposure vs credit limit</CardTitle>
              <ExportMenu label="exposure" onExcel={() => exportExposure("xlsx")} onPdf={() => exportExposure("pdf")} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Counterparty</TableHead>
                  <TableHead className="text-right">Net Exposure</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Pipeline</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Credit limit</TableHead>
                  <TableHead>Utilization</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {exposure.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.legal_name}</TableCell>
                      <TableCell className="text-right font-mono">{fmtEur(e.net_exposure)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground hidden md:table-cell">{fmtEur(e.pipeline)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground hidden md:table-cell">{fmtEur(e.credit_limit_eur)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[140px]">
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
                      <TableCell>
                        <Button asChild size="sm" variant="ghost" aria-label="Drill down">
                          <Link to={`/risk/counterparty/${e.id}`}><ChevronRight className="h-4 w-4" /></Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {exposure.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">No counterparties yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* NOP chart */}
            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" />Net Open Position — next 14 days (MWh)</CardTitle>
                <ExportMenu label="NOP" onExcel={() => exportNop("xlsx")} onPdf={() => exportNop("pdf")} />
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={nop} onClick={(state: any) => {
                    const iso = state?.activePayload?.[0]?.payload?.iso;
                    if (iso) window.location.assign(`/risk/nop/${iso}`);
                  }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <Bar dataKey="buy" stackId="a" fill="hsl(var(--accent))" name="Buy" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="sell" stackId="a" fill="hsl(var(--destructive))" name="Sell" radius={[0, 0, 0, 0]} />
                    <Line type="monotone" dataKey="net" stroke="hsl(var(--primary))" strokeWidth={2} name="Net" dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-muted-foreground mt-2">Click a bar to drill into the day. Scheduled days use schedule_lines; estimated days spread trade volume evenly.</p>
              </CardContent>
            </Card>

            {/* Aging */}
            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" />Customer debt aging</CardTitle>
                <ExportMenu label="aging" onExcel={() => exportAging("xlsx")} onPdf={() => exportAging("pdf")} />
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Bucket (days overdue)</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead></TableHead></TableRow></TableHeader>
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
                        <TableCell>
                          {v.count > 0 && (
                            <Button asChild size="sm" variant="ghost" aria-label={`Drill into ${k}`}>
                              <Link to={`/risk/aging/${encodeURIComponent(k)}`}><ChevronRight className="h-4 w-4" /></Link>
                            </Button>
                          )}
                        </TableCell>
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
              <CardHeader><CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" />Concentration risk — top 5 (HHI {hhi})</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {concentration.map(c => (
                  <div key={c.id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <Link to={`/risk/counterparty/${c.id}`} className="truncate hover:underline">{c.legal_name}</Link>
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