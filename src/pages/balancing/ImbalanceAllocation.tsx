import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/erp/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Scale, Users, Play } from "lucide-react";

/**
 * Imbalance cost allocation per client — internal analytics, never invoiced.
 * Method (directional):
 *   For every hour: portfolio deviation D_h = actual − scheduled NOP.
 *   Hour cost C_h = |D_h| × price(direction).
 *   Client hourly deviation d_ch = actual_ch − baseline_ch, where the baseline
 *   is the client's own trailing 14-day mean for the same hour & day type.
 *   Allocation_ch = C_h × d_ch / D_h  → clients deviating WITH the portfolio
 *   pay pro-rata; clients deviating AGAINST it receive a credit automatically.
 * Hours with |D_h| below the threshold are skipped (noise).
 */
export default function ImbalanceAllocation() {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [bg, setBg] = useState<string>("");
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [dual, setDual] = useState(true);
  const [singlePrice, setSinglePrice] = useState(85);
  const [upPrice, setUpPrice] = useState(125);
  const [downPrice, setDownPrice] = useState(45);
  const [minDev, setMinDev] = useState(0.05); // MWh — skip noise hours
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ clientId: string; name: string; actual: number; deviation: number; allocated: number; invoiced: number }[]>([]);
  const [hoursUsed, setHoursUsed] = useState(0);

  useEffect(() => { supabase.from("balance_groups").select("id,name").then(({ data }) => { setGroups(data ?? []); if (data?.[0]) setBg(data[0].id); }); }, []);

  async function compute() {
    if (!bg) { toast({ title: "Pick a balance group", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const [y, m] = period.split("-").map(Number);
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 0, 23, 59, 59));
      const histStart = new Date(start.getTime() - 14 * 86400_000);

      const [{ data: cps }, { data: clientRows }, { data: sched }, { data: iv }, { data: hol }, { data: invs }] = await Promise.all([
        (supabase.from as any)("metering_points").select("id, client_id").eq("balance_group_id", bg).eq("status", "active"),
        supabase.from("clients").select("id, company_name"),
        supabase.from("balance_schedules").select("date, mtu, scheduled_mwh, leg, version").eq("balance_group_id", bg).gte("date", start.toISOString().slice(0, 10)).lte("date", end.toISOString().slice(0, 10)),
        supabase.from("consumption_readings").select("metering_point_id, reading_at, actual_mwh, quality").gte("reading_at", histStart.toISOString()).lte("reading_at", end.toISOString()).limit(200000),
        (supabase.from as any)("public_holidays").select("holiday_date"),
        supabase.from("invoices").select("client_id, total_eur, period_start").gte("period_start", start.toISOString().slice(0, 10)).lte("period_start", end.toISOString().slice(0, 10)),
      ]);

      const clientOf = new Map<string, string>();
      ((cps ?? []) as any[]).forEach(c => { if (c.client_id) clientOf.set(c.id, c.client_id); });
      const names = new Map<string, string>();
      ((clientRows ?? []) as any[]).forEach(c => names.set(c.id, c.company_name));
      const holidays = new Set<string>(((hol ?? []) as any[]).map(h => String(h.holiday_date)));
      const dayType = (d: Date) => { const iso = d.toISOString().slice(0, 10); if (holidays.has(iso)) return "SU"; const w = d.getUTCDay(); return w === 0 ? "SU" : w === 6 ? "SA" : "WD"; };

      // Scheduled NOP per hour of the month (latest version per day)
      const maxV = new Map<string, number>();
      ((sched ?? []) as any[]).forEach(r => maxV.set(r.date, Math.max(maxV.get(r.date) ?? 0, r.version)));
      const nop = new Map<string, number>(); // "date|h" -> MWh
      for (const r of ((sched ?? []) as any[])) {
        if (r.version !== maxV.get(r.date)) continue;
        const k = `${r.date}|${Math.floor(r.mtu / 4)}`;
        const sign = r.leg === "PV" ? -1 : 1;
        nop.set(k, (nop.get(k) ?? 0) + sign * Number(r.scheduled_mwh || 0));
      }

      // Client hourly actuals in month + trailing baselines (hour × daytype)
      const actualCH = new Map<string, number>();      // "client|date|h"
      const portfolioH = new Map<string, number>();    // "date|h"
      const baseAgg = new Map<string, { s: number; n: number }>(); // "client|dt|h"
      const monthStartISO = start.toISOString();
      for (const r of ((iv ?? []) as any[])) {
        if ((r.quality ?? "measured") === "flagged") continue;
        const cid = clientOf.get(r.metering_point_id); if (!cid) continue;
        const ts = new Date(r.reading_at);
        const v = Number(r.actual_mwh || 0);
        const h = ts.getUTCHours();
        if (r.reading_at >= monthStartISO) {
          const dISO = ts.toISOString().slice(0, 10);
          actualCH.set(`${cid}|${dISO}|${h}`, (actualCH.get(`${cid}|${dISO}|${h}`) ?? 0) + v);
          portfolioH.set(`${dISO}|${h}`, (portfolioH.get(`${dISO}|${h}`) ?? 0) + v);
        } else {
          const k = `${cid}|${dayType(ts)}|${h}`;
          const b = baseAgg.get(k) ?? { s: 0, n: 0 }; b.s += v; b.n += 1; baseAgg.set(k, b);
        }
      }
      const baseline = (cid: string, d: Date, h: number) => {
        const b = baseAgg.get(`${cid}|${dayType(d)}|${h}`);
        return b && b.n > 0 ? b.s / b.n : null;
      };

      // Walk hours: allocate
      const alloc = new Map<string, { actual: number; deviation: number; allocated: number }>();
      const touch = (cid: string) => { if (!alloc.has(cid)) alloc.set(cid, { actual: 0, deviation: 0, allocated: 0 }); return alloc.get(cid)!; };
      let used = 0;
      for (const [key, act] of portfolioH) {
        const [dISO, hStr] = key.split("|"); const h = Number(hStr);
        const schedH = nop.get(key);
        if (schedH === undefined) continue; // no schedule that day — nothing to settle against
        const D = act - schedH;
        // per-client deviations this hour
        const perClient: { cid: string; d: number; a: number }[] = [];
        for (const [cid] of names) {
          const a = actualCH.get(`${cid}|${dISO}|${h}`);
          if (a === undefined) continue;
          const b = baseline(cid, new Date(`${dISO}T00:00:00Z`), h);
          if (b === null) continue;
          perClient.push({ cid, d: a - b, a });
        }
        for (const pc of perClient) { const t = touch(pc.cid); t.actual += pc.a; }
        if (Math.abs(D) < minDev) continue;
        used++;
        const price = dual ? (D >= 0 ? downPrice : upPrice) : singlePrice;
        const C = Math.abs(D) * price;
        for (const pc of perClient) {
          const t = touch(pc.cid);
          t.deviation += pc.d;
          t.allocated += C * (pc.d / D); // with-portfolio pays, against-portfolio credited
        }
      }

      const invoiced = new Map<string, number>();
      ((invs ?? []) as any[]).forEach(i => invoiced.set(i.client_id, (invoiced.get(i.client_id) ?? 0) + Number(i.total_eur || 0)));

      const out = [...alloc.entries()].map(([cid, v]) => ({
        clientId: cid, name: names.get(cid) ?? cid.slice(0, 8),
        actual: +v.actual.toFixed(2), deviation: +v.deviation.toFixed(2),
        allocated: +v.allocated.toFixed(0), invoiced: +(invoiced.get(cid) ?? 0).toFixed(0),
      })).sort((a, b) => b.allocated - a.allocated);
      setResult(out);
      setHoursUsed(used);
      toast({ title: "Allocation computed", description: `${out.length} clients over ${used} settled hours` });
    } finally { setBusy(false); }
  }

  const totals = useMemo(() => result.reduce((s, r) => ({ allocated: s.allocated + r.allocated, invoiced: s.invoiced + r.invoiced }), { allocated: 0, invoiced: 0 }), [result]);

  return (
    <ErpLayout title="Imbalance Allocation" subtitle="Who is eating the margin — internal analytics, never invoiced"
      actions={<Button size="sm" onClick={compute} disabled={busy}><Play className="h-4 w-4 mr-1" />{busy ? "Computing…" : "Compute"}</Button>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Clients" value={String(result.length)} icon={Users} />
        <StatCard label="Settled hours" value={String(hoursUsed)} icon={Scale} accent="accent" />
        <StatCard label="Allocated cost" value={`€ ${totals.allocated.toFixed(0)}`} icon={Scale} accent="warning" />
        <StatCard label="vs invoiced" value={totals.invoiced > 0 ? `${(totals.allocated / totals.invoiced * 100).toFixed(1)}%` : "—"} icon={Scale} accent={totals.invoiced > 0 && totals.allocated / totals.invoiced > 0.05 ? "warning" : "primary"} />
      </div>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Parameters</CardTitle><CardDescription>Baseline = client's own trailing 14-day mean per hour & day type. Deviations WITH the portfolio pay; AGAINST it get credited.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field label="Period"><Input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></Field>
          <Field label="Balance group"><Select value={bg} onValueChange={setBg}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select></Field>
          <div className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 mt-5"><Label className="text-xs">Dual pricing</Label><Switch checked={dual} onCheckedChange={setDual} /></div>
          {!dual && <Field label="Single €/MWh"><Input type="number" value={singlePrice} onChange={e => setSinglePrice(+e.target.value)} /></Field>}
          {dual && <>
            <Field label="Up €/MWh"><Input type="number" value={upPrice} onChange={e => setUpPrice(+e.target.value)} /></Field>
            <Field label="Down €/MWh"><Input type="number" value={downPrice} onChange={e => setDownPrice(+e.target.value)} /></Field>
          </>}
          <Field label="Min |dev| MWh/h"><Input type="number" step="0.01" value={minDev} onChange={e => setMinDev(+e.target.value)} /></Field>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Per-client allocation</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Actual MWh</TableHead>
              <TableHead className="text-right">Net deviation MWh</TableHead>
              <TableHead className="text-right">Allocated €</TableHead>
              <TableHead className="text-right">Invoiced €</TableHead>
              <TableHead className="text-right">Imbalance % of invoice</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {result.map(r => (
                <TableRow key={r.clientId}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.actual.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.deviation >= 0 ? "+" : ""}{r.deviation.toFixed(2)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${r.allocated < 0 ? "text-primary" : ""}`}>{r.allocated < 0 ? "−" : ""}€ {Math.abs(r.allocated).toFixed(0)}{r.allocated < 0 ? " credit" : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">€ {r.invoiced.toFixed(0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.invoiced > 0 ? <Badge variant={r.allocated / r.invoiced > 0.05 ? "destructive" : "outline"}>{(r.allocated / r.invoiced * 100).toFixed(1)}%</Badge> : "—"}</TableCell>
                </TableRow>
              ))}
              {result.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">Pick period and press Compute.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {result.length > 0 && (
        <Card className="border-border/60">
          <CardHeader><CardTitle>Top allocated cost</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <BarChart data={result.slice(0, 10)}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="allocated" name="Allocated €" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </ErpLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>{children}</div>;
}
