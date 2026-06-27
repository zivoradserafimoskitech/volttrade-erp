import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/erp/StatCard";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { shape24h, SlpCategory, seasonOf, dayTypeOf } from "@/lib/slpSynthesis";
import { CalendarClock, Lock, Send, Activity } from "lucide-react";

export default function Scheduling() {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [bg, setBg] = useState<string>("");
  const [date, setDate] = useState<string>(() => new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  const [profiledMwh, setProfiledMwh] = useState(24); // total day
  const [measuredMwh, setMeasuredMwh] = useState(12);
  const [pvKwp, setPvKwp] = useState(500);
  const [profileCat, setProfileCat] = useState<SlpCategory>("Office");
  const [version, setVersion] = useState(1);
  const [gateClosed, setGateClosed] = useState<string | null>(null);

  useEffect(() => { supabase.from("balance_groups").select("id,name").then(({ data }) => { setGroups(data ?? []); if (data?.[0]) setBg(data[0].id); }); }, []);

  const rows = useMemo(() => {
    const d = new Date(date + "T00:00:00");
    const shape = shape24h(profileCat, seasonOf(d), dayTypeOf(d));
    // expand to 96 MTU (15min) by replicating hourly share / 4
    return Array.from({ length: 96 }, (_, mtu) => {
      const h = Math.floor(mtu / 4);
      const share = shape[h] / 4;
      // clear-sky-ish PV (solar curve)
      const solar = h < 6 || h > 20 ? 0 : Math.sin(((h - 6) / 14) * Math.PI);
      const pvMwh = (pvKwp * solar) / 1000 / 4;
      const profiled = profiledMwh * share;
      // measured: stable + small peaks
      const m = (Math.exp(-Math.pow((h - 10) / 3, 2)) + Math.exp(-Math.pow((h - 19) / 3, 2))) ;
      const measured = (measuredMwh / 24) * (1 + 0.3 * m);
      const nop = profiled + measured - pvMwh;
      return { mtu, label: `${String(Math.floor(mtu / 4)).padStart(2, "0")}:${String((mtu % 4) * 15).padStart(2, "0")}`, profiled: +profiled.toFixed(4), measured: +(measured / 4).toFixed(4), pv: +pvMwh.toFixed(4), nop: +nop.toFixed(4) };
    });
  }, [date, profiledMwh, measuredMwh, pvKwp, profileCat]);

  const totals = {
    profiled: rows.reduce((s, r) => s + r.profiled, 0),
    measured: rows.reduce((s, r) => s + r.measured, 0),
    pv: rows.reduce((s, r) => s + r.pv, 0),
    nop: rows.reduce((s, r) => s + r.nop, 0),
  };

  async function publish() {
    if (!bg) { toast({ title: "Pick a balance group", variant: "destructive" }); return; }
    const ts = new Date().toISOString();
    const payload = rows.flatMap(r => ([
      { balance_group_id: bg, date, mtu: r.mtu, scheduled_mwh: r.profiled, leg: "PROFILED" as const, version, gate_closure_ts: ts },
      { balance_group_id: bg, date, mtu: r.mtu, scheduled_mwh: r.measured, leg: "MEASURED" as const, version, gate_closure_ts: ts },
      { balance_group_id: bg, date, mtu: r.mtu, scheduled_mwh: r.pv, leg: "PV" as const, version, gate_closure_ts: ts },
    ]));
    const { error } = await supabase.from("balance_schedules").upsert(payload, { onConflict: "balance_group_id,date,mtu,leg,version" });
    if (error) { toast({ title: "Publish failed", description: error.message, variant: "destructive" }); return; }
    setGateClosed(ts);
    toast({ title: `Schedule v${version} published`, description: `Gate closure ${new Date(ts).toLocaleString()}` });
  }

  async function submitToTso() {
    const fn = await supabase.functions.invoke("submit-schedule", { body: { balance_group_id: bg, date, version } });
    if (fn.error) { toast({ title: "TSO submit failed", description: fn.error.message, variant: "destructive" }); return; }
    toast({ title: "Submitted to TSO (stub)", description: `Ack: ${(fn.data as any)?.ack ?? "OK"}` });
  }

  return (
    <ErpLayout title="Scheduling & Nomination" subtitle="Profiled (SLP) + Measured + PV legs · NOP per MTU"
      actions={<>
        <Button size="sm" variant="outline" onClick={publish}><Lock className="h-4 w-4 mr-1" />Publish v{version}</Button>
        <Button size="sm" onClick={submitToTso}><Send className="h-4 w-4 mr-1" />Submit to TSO</Button>
      </>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Profiled day total" value={`${totals.profiled.toFixed(2)} MWh`} icon={Activity} />
        <StatCard label="Measured day total" value={`${totals.measured.toFixed(2)} MWh`} icon={Activity} accent="accent" />
        <StatCard label="PV generation" value={`${totals.pv.toFixed(2)} MWh`} icon={Activity} accent="primary" />
        <StatCard label="Net position" value={`${totals.nop.toFixed(2)} MWh`} icon={CalendarClock} accent={totals.nop > 0 ? "warning" : "primary"} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Inputs</CardTitle>
          <CardDescription>Profiled leg shape = SLP × volume forecast · Imbalance ≈ 0 by construction</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field label="Balance group"><Select value={bg} onValueChange={setBg}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Profiled MWh / day"><Input type="number" value={profiledMwh} onChange={e => setProfiledMwh(+e.target.value)} /></Field>
          <Field label="Measured MWh / day"><Input type="number" value={measuredMwh} onChange={e => setMeasuredMwh(+e.target.value)} /></Field>
          <Field label="PV kWp"><Input type="number" value={pvKwp} onChange={e => setPvKwp(+e.target.value)} /></Field>
          <Field label="Version"><Input type="number" value={version} onChange={e => setVersion(+e.target.value)} /></Field>
          {gateClosed && <div className="md:col-span-6 text-xs text-muted-foreground">Last gate closure: <Badge variant="secondary">{new Date(gateClosed).toLocaleString()}</Badge></div>}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Net position per MTU</CardTitle><CardDescription>15-minute settlement basis · feeds Trading NOP</CardDescription></CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={rows}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="profiled" stackId="load" name="Profiled" fill="hsl(var(--primary))" />
              <Bar dataKey="measured" stackId="load" name="Measured" fill="hsl(var(--accent))" />
              <Bar dataKey="pv" name="PV" fill="hsl(var(--warning))" />
              <Line type="monotone" dataKey="nop" name="NOP" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>{children}</div>;
}