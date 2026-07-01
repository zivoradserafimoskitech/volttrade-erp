import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { SLP_CATEGORIES } from "@/lib/slpSynthesis";
import { Users, Plus, Sun, Bolt } from "lucide-react";
import { StatCard } from "@/components/erp/StatCard";

type Cp = any;

const CONSUMER_TYPES = ["Residential","SOHO","SME","Industrial","Public"] as const;

export default function ConsumerManager() {
  const [rows, setRows] = useState<Cp[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; code: string }[]>([]);
  const [filterCat, setFilterCat] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPro, setFilterPro] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>({ metering_category: "PROFILED", consumer_type: "SOHO", is_prosumer: false, has_private_meter: false, status: "active" });

  async function load() {
    const [{ data: cps }, { data: bgs }] = await Promise.all([
      supabase.from("metering_points").select("*").order("created_at", { ascending: false }),
      supabase.from("balance_groups").select("id,name,code").order("name"),
    ]);
    setRows(cps ?? []); setGroups(bgs ?? []);
  }
  useEffect(() => { load(); }, []);

  const filtered = rows.filter(r =>
    (filterCat === "all" || r.metering_category === filterCat) &&
    (filterType === "all" || r.consumer_type === filterType) &&
    (filterPro === "all" || (filterPro === "yes" ? r.is_prosumer : !r.is_prosumer))
  );

  const totals = {
    all: rows.length,
    profiled: rows.filter(r => r.metering_category === "PROFILED").length,
    measured: rows.filter(r => r.metering_category === "MEASURED").length,
    prosumers: rows.filter(r => r.is_prosumer).length,
  };

  async function save() {
    if (!draft.metering_category) return;
    if (draft.metering_category === "PROFILED" && !draft.slp_category) {
      toast({ title: "Pick SLP category", description: "Profiled customers need an SLP profile.", variant: "destructive" });
      return;
    }
    const payload: any = {
      edu_code: draft.eic_metering_id || `MP-${Date.now()}`,
      consumer_category: draft.metering_category === "PROFILED" ? "slp" : "smart_hourly",
      metering_category: draft.metering_category,
      slp_category: draft.slp_category ?? null,
      consumer_type: draft.consumer_type,
      voltage_level: draft.voltage_level ?? null,
      connected_power_kw: draft.connection_power_kw ?? null,
      eic_metering_id: draft.eic_metering_id ?? null,
      dso_meter_id: draft.dso_meter_id ?? null,
      tariff_type: draft.tariff_type ?? null,
      balance_group_id: draft.balance_group_id ?? null,
      has_private_meter: !!draft.has_private_meter,
      is_prosumer: !!draft.is_prosumer,
      pv_capacity_kw: draft.pv_capacity_kwp ?? null,
      has_pv: !!draft.is_prosumer,
      prosumer_scheme: draft.is_prosumer ? (draft.prosumer_scheme ?? null) : null,
      status: draft.status ?? "active",
    };
    const { error } = await supabase.from("metering_points").insert(payload);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Saved" });
    setOpen(false); setDraft({ metering_category: "PROFILED", consumer_type: "SOHO", is_prosumer: false, has_private_meter: false, status: "active" });
    load();
  }

  return (
    <ErpLayout title="Consumer Manager" subtitle="Connection-point categorization · profiled vs measured · prosumer scheme"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New connection point</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New connection point</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Metering category">
                <Select value={draft.metering_category} onValueChange={v => setDraft({ ...draft, metering_category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PROFILED">PROFILED (≤40 kW)</SelectItem>
                    <SelectItem value="MEASURED">MEASURED (&gt;40 kW)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="SLP category"><Select value={draft.slp_category ?? ""} onValueChange={v => setDraft({ ...draft, slp_category: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{SLP_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select></Field>
              <Field label="Consumer type"><Select value={draft.consumer_type} onValueChange={v => setDraft({ ...draft, consumer_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONSUMER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select></Field>
              <Field label="Voltage level"><Input value={draft.voltage_level ?? ""} onChange={e => setDraft({ ...draft, voltage_level: e.target.value })} placeholder="LV / MV / HV" /></Field>
              <Field label="Connection power (kW)"><Input type="number" value={draft.connection_power_kw ?? ""} onChange={e => setDraft({ ...draft, connection_power_kw: +e.target.value })} /></Field>
              <Field label="EIC metering id"><Input value={draft.eic_metering_id ?? ""} onChange={e => setDraft({ ...draft, eic_metering_id: e.target.value })} /></Field>
              <Field label="DSO meter id"><Input value={draft.dso_meter_id ?? ""} onChange={e => setDraft({ ...draft, dso_meter_id: e.target.value })} /></Field>
              <Field label="Tariff type"><Input value={draft.tariff_type ?? ""} onChange={e => setDraft({ ...draft, tariff_type: e.target.value })} /></Field>
              <Field label="Balance group"><Select value={draft.balance_group_id ?? ""} onValueChange={v => setDraft({ ...draft, balance_group_id: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select></Field>
              <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <Label className="text-xs">Has private smart meter</Label>
                <Switch checked={draft.has_private_meter} onCheckedChange={v => setDraft({ ...draft, has_private_meter: v })} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <Label className="text-xs">Prosumer</Label>
                <Switch checked={draft.is_prosumer} onCheckedChange={v => setDraft({ ...draft, is_prosumer: v })} />
              </div>
              {draft.is_prosumer && <>
                <Field label="PV capacity (kWp)"><Input type="number" value={draft.pv_capacity_kwp ?? ""} onChange={e => setDraft({ ...draft, pv_capacity_kwp: +e.target.value })} /></Field>
                <Field label="Prosumer scheme"><Select value={draft.prosumer_scheme ?? ""} onValueChange={v => setDraft({ ...draft, prosumer_scheme: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="NET_METERING">Net metering</SelectItem><SelectItem value="NET_BILLING">Net billing</SelectItem></SelectContent>
                </Select></Field>
              </>}
            </div>
            <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      }>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total points" value={String(totals.all)} icon={Users} />
        <StatCard label="Profiled (≤40 kW)" value={String(totals.profiled)} icon={Bolt} accent="accent" />
        <StatCard label="Measured (>40 kW)" value={String(totals.measured)} icon={Bolt} accent="warning" />
        <StatCard label="Prosumers" value={String(totals.prosumers)} icon={Sun} accent="primary" />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Connection points</CardTitle>
          <CardDescription>Filter by category, type or prosumer status</CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Select value={filterCat} onValueChange={setFilterCat}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">All categories</SelectItem><SelectItem value="PROFILED">Profiled</SelectItem><SelectItem value="MEASURED">Measured</SelectItem>
            </SelectContent></Select>
            <Select value={filterType} onValueChange={setFilterType}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">All types</SelectItem>{CONSUMER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent></Select>
            <Select value={filterPro} onValueChange={setFilterPro}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">All</SelectItem><SelectItem value="yes">Prosumers</SelectItem><SelectItem value="no">Non-prosumers</SelectItem>
            </SelectContent></Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>EIC</TableHead><TableHead>Category</TableHead><TableHead>SLP</TableHead><TableHead>Type</TableHead>
              <TableHead>kW</TableHead><TableHead>Voltage</TableHead><TableHead>Prosumer</TableHead><TableHead>Private meter</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.eic_metering_id ?? "—"}</TableCell>
                  <TableCell><Badge variant={r.metering_category === "PROFILED" ? "secondary" : "default"}>{r.metering_category}</Badge></TableCell>
                  <TableCell className="text-xs">{r.slp_category ?? "—"}</TableCell>
                  <TableCell>{r.consumer_type}</TableCell>
                  <TableCell className="tabular-nums">{r.connection_power_kw ?? "—"}</TableCell>
                  <TableCell>{r.voltage_level ?? "—"}</TableCell>
                  <TableCell>{r.is_prosumer ? <Badge variant="outline" className="gap-1"><Sun className="h-3 w-3" />{r.prosumer_scheme ?? "—"}</Badge> : "—"}</TableCell>
                  <TableCell>{r.has_private_meter ? "Yes" : "No"}</TableCell>
                  <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No connection points yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>{children}</div>;
}