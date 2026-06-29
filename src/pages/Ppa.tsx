import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Plus, Trash2, FileDown, FileText, Calculator, Handshake } from "lucide-react";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";
import { exportToExcel, exportToPdf } from "@/lib/exports";

type Ppa = any; type Settle = any; type Client = { id: string; company_name: string };

const TYPE_LABEL: Record<string, string> = {
  virtual_sleeved: "Virtual / Sleeved",
  pay_as_produced: "Pay-as-produced (collar)",
  surplus_buyback: "Surplus buy-back",
};

export default function PpaPage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [edus, setEdus] = useState<any[]>([]);
  const [ppas, setPpas] = useState<Ppa[]>([]);
  const [settles, setSettles] = useState<Settle[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("pay_as_produced");
  const [selectedClient, setSelectedClient] = useState("");
  const [settleOpen, setSettleOpen] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const [{ data: cs }, { data: es }, { data: ps }, { data: ss }] = await Promise.all([
      supabase.from("clients").select("id,company_name").order("company_name"),
      supabase.from("metering_points").select("id,client_id,edu_code"),
      supabase.from("ppa_agreements").select("*").order("created_at", { ascending: false }),
      supabase.from("ppa_settlements").select("*").order("period_month", { ascending: false }),
    ]);
    setClients((cs as any) ?? []); setEdus(es ?? []); setPpas((ps as any) ?? []); setSettles((ss as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const addPpa = async (form: FormData) => {
    const payload: any = {
      user_id: user!.id,
      client_id: form.get("client_id"),
      metering_point_id: form.get("metering_point_id") || null,
      ppa_code: form.get("ppa_code"),
      ppa_type: type,
      start_date: form.get("start_date"),
      end_date: form.get("end_date"),
      contracted_volume_mwh: form.get("contracted_volume_mwh") ? Number(form.get("contracted_volume_mwh")) : null,
      fixed_price_eur_mwh: Number(form.get("fixed_price_eur_mwh")),
      floor_price_eur_mwh: form.get("floor_price_eur_mwh") ? Number(form.get("floor_price_eur_mwh")) : null,
      ceiling_price_eur_mwh: form.get("ceiling_price_eur_mwh") ? Number(form.get("ceiling_price_eur_mwh")) : null,
      buyback_price_eur_mwh: form.get("buyback_price_eur_mwh") ? Number(form.get("buyback_price_eur_mwh")) : null,
      status: "active",
      notes: form.get("notes") || null,
    };
    const { error } = await supabase.from("ppa_agreements").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("PPA created"); setOpen(false); load();
  };

  const removePpa = async (id: string) => {
    if (!confirm("Delete this PPA and its settlements?")) return;
    const { error } = await supabase.from("ppa_agreements").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const addSettlement = async (form: FormData, ppa: Ppa) => {
    const produced = Number(form.get("produced_mwh") || 0);
    const delivered = Number(form.get("delivered_mwh") || produced);
    const surplus = Number(form.get("surplus_export_mwh") || 0);
    const spot = form.get("spot_avg_eur_mwh") ? Number(form.get("spot_avg_eur_mwh")) : null;
    // Apply collar (pay-as-produced)
    let applied = Number(ppa.fixed_price_eur_mwh);
    if (ppa.ppa_type === "pay_as_produced" && spot !== null) {
      const f = ppa.floor_price_eur_mwh ?? applied;
      const c = ppa.ceiling_price_eur_mwh ?? applied;
      applied = Math.min(c, Math.max(f, spot));
    }
    const energy = +(delivered * applied).toFixed(2);
    const credit = +(surplus * Number(ppa.buyback_price_eur_mwh ?? 0)).toFixed(2);
    const net = +(energy - credit).toFixed(2);
    const period = String(form.get("period_month")) + "-01";
    const { error } = await supabase.from("ppa_settlements").insert({
      ppa_id: ppa.id, period_month: period, produced_mwh: produced, delivered_mwh: delivered,
      surplus_export_mwh: surplus, spot_avg_eur_mwh: spot, applied_price_eur_mwh: applied,
      energy_cost_eur: energy, buyback_credit_eur: credit, net_amount_eur: net, status: "draft",
    });
    if (error) return toast.error(error.message);
    toast.success("Settlement recorded"); setSettleOpen(null); load();
  };

  const clientName = (id: string) => clients.find(c => c.id === id)?.company_name ?? "—";

  const exportCols = [
    { key: "ppa_code", label: "PPA" },
    { key: "client", label: "Client" },
    { key: "ppa_type", label: "Type" },
    { key: "period", label: "Period" },
    { key: "produced_mwh", label: "Produced (MWh)", format: "num" as const },
    { key: "delivered_mwh", label: "Delivered (MWh)", format: "num" as const },
    { key: "surplus_export_mwh", label: "Surplus (MWh)", format: "num" as const },
    { key: "applied_price_eur_mwh", label: "Price (€/MWh)", format: "num" as const },
    { key: "energy_cost_eur", label: "Energy cost (€)", format: "eur" as const },
    { key: "buyback_credit_eur", label: "Buy-back credit (€)", format: "eur" as const },
    { key: "net_amount_eur", label: "Net (€)", format: "eur" as const },
  ];
  const rowsForExport = settles.map(s => {
    const p = ppas.find(x => x.id === s.ppa_id);
    return { ...s, ppa_code: p?.ppa_code ?? "—", client: p ? clientName(p.client_id) : "—",
      ppa_type: p ? TYPE_LABEL[p.ppa_type] : "", period: String(s.period_month).slice(0, 7) };
  });

  const downloadStatement = (s: Settle) => {
    const p = ppas.find(x => x.id === s.ppa_id); if (!p) return;
    exportToPdf({
      title: `PPA Monthly Statement · ${p.ppa_code}`,
      subtitle: `${clientName(p.client_id)} · ${String(s.period_month).slice(0, 7)}`,
      filename: `ppa-${p.ppa_code}-${String(s.period_month).slice(0,7)}`,
      sections: [{
        heading: `${TYPE_LABEL[p.ppa_type]} — applied price € ${Number(s.applied_price_eur_mwh).toFixed(2)}/MWh`,
        columns: [
          { key: "metric", label: "Metric" },
          { key: "value", label: "Value" },
        ],
        rows: [
          { metric: "Produced (MWh)", value: fmtNum(s.produced_mwh) },
          { metric: "Delivered to consumer (MWh)", value: fmtNum(s.delivered_mwh) },
          { metric: "Surplus exported (MWh)", value: fmtNum(s.surplus_export_mwh) },
          { metric: "Day-ahead spot avg (€/MWh)", value: s.spot_avg_eur_mwh != null ? Number(s.spot_avg_eur_mwh).toFixed(2) : "—" },
          { metric: "Fixed price (€/MWh)", value: Number(p.fixed_price_eur_mwh).toFixed(2) },
          { metric: "Floor / Ceiling (€/MWh)", value: `${p.floor_price_eur_mwh ?? "—"} / ${p.ceiling_price_eur_mwh ?? "—"}` },
          { metric: "Buy-back price (€/MWh)", value: p.buyback_price_eur_mwh != null ? Number(p.buyback_price_eur_mwh).toFixed(2) : "—" },
        ],
        totals: { metric: "Net amount (€)", value: `€ ${Number(s.net_amount_eur).toFixed(2)}` },
      }],
    });
  };

  const filteredPpas = useMemo(() => selectedClient ? ppas.filter(p => p.client_id === selectedClient) : ppas, [ppas, selectedClient]);

  return (
    <ErpLayout title="PPA Agreements" subtitle="Power Purchase Agreements — virtual/sleeved, pay-as-produced with collar, surplus buy-back"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportToExcel("ppa-settlements", [{ name: "Settlements", columns: exportCols as any, rows: rowsForExport }])}>
            <FileDown className="h-4 w-4 mr-2" />Excel
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New PPA</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>New Power Purchase Agreement</DialogTitle></DialogHeader>
              <form onSubmit={e => { e.preventDefault(); addPpa(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label>Client</Label>
                  <Select name="client_id" required>
                    <SelectTrigger><SelectValue placeholder="Pick client…" /></SelectTrigger>
                    <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>PPA type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="virtual_sleeved">Virtual / Sleeved (off-site producer)</SelectItem>
                      <SelectItem value="pay_as_produced">Pay-as-produced with floor/ceiling</SelectItem>
                      <SelectItem value="surplus_buyback">Surplus export buy-back (prosumer)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field name="ppa_code" label="PPA code" required placeholder="PPA-2026-001" />
                <div className="space-y-2">
                  <Label>Linked supply point (optional)</Label>
                  <Select name="metering_point_id"><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{edus.map(e => <SelectItem key={e.id} value={e.id}>{e.edu_code}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Field name="start_date" label="Start date" type="date" required />
                <Field name="end_date" label="End date" type="date" required />
                <Field name="contracted_volume_mwh" label="Contracted volume (MWh/yr)" type="number" step="0.01" />
                <Field name="fixed_price_eur_mwh" label="Fixed price (€/MWh)" type="number" step="0.01" required />
                {type === "pay_as_produced" && (
                  <>
                    <Field name="floor_price_eur_mwh" label="Floor price (€/MWh)" type="number" step="0.01" />
                    <Field name="ceiling_price_eur_mwh" label="Ceiling price (€/MWh)" type="number" step="0.01" />
                  </>
                )}
                {(type === "surplus_buyback" || type === "pay_as_produced") && (
                  <Field name="buyback_price_eur_mwh" label="Surplus buy-back price (€/MWh)" type="number" step="0.01" />
                )}
                <div className="space-y-2 col-span-2">
                  <Label>Notes</Label><Input name="notes" />
                </div>
                <DialogFooter className="col-span-2"><Button type="submit">Create PPA</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <div className="text-xs text-muted-foreground">Filter by client</div>
        <Select value={selectedClient || "all"} onValueChange={v => setSelectedClient(v === "all" ? "" : v)}>
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="agreements" className="mt-4">
        <TabsList>
          <TabsTrigger value="agreements"><Handshake className="h-4 w-4 mr-2" />Agreements ({filteredPpas.length})</TabsTrigger>
          <TabsTrigger value="settlements"><Calculator className="h-4 w-4 mr-2" />Monthly settlements ({settles.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="agreements">
          <Card className="border-border/60"><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>PPA</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead>
                <TableHead>Term</TableHead><TableHead className="text-right">Fixed €/MWh</TableHead>
                <TableHead>Collar</TableHead><TableHead className="text-right">Buy-back</TableHead>
                <TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredPpas.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.ppa_code}</TableCell>
                    <TableCell>{clientName(p.client_id)}</TableCell>
                    <TableCell><Badge variant="secondary">{TYPE_LABEL[p.ppa_type]}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.start_date} → {p.end_date}</TableCell>
                    <TableCell className="text-right">{fmtNum(p.fixed_price_eur_mwh)}</TableCell>
                    <TableCell className="text-xs">{p.floor_price_eur_mwh ?? "—"} / {p.ceiling_price_eur_mwh ?? "—"}</TableCell>
                    <TableCell className="text-right">{p.buyback_price_eur_mwh != null ? fmtNum(p.buyback_price_eur_mwh) : "—"}</TableCell>
                    <TableCell><Badge>{p.status}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      <Dialog open={settleOpen === p.id} onOpenChange={o => setSettleOpen(o ? p.id : null)}>
                        <DialogTrigger asChild><Button size="sm" variant="ghost">+ Settle</Button></DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Monthly settlement · {p.ppa_code}</DialogTitle></DialogHeader>
                          <form onSubmit={e => { e.preventDefault(); addSettlement(new FormData(e.currentTarget), p); }} className="grid grid-cols-2 gap-3">
                            <Field name="period_month" label="Month" type="month" required />
                            <Field name="spot_avg_eur_mwh" label="Spot avg (€/MWh)" type="number" step="0.01" />
                            <Field name="produced_mwh" label="Produced (MWh)" type="number" step="0.001" required />
                            <Field name="delivered_mwh" label="Delivered (MWh)" type="number" step="0.001" />
                            <Field name="surplus_export_mwh" label="Surplus exported (MWh)" type="number" step="0.001" />
                            <DialogFooter className="col-span-2"><Button type="submit">Compute & save</Button></DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                      <Button size="icon" variant="ghost" onClick={() => removePpa(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredPpas.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">No PPAs yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="settlements">
          <Card className="border-border/60"><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Month</TableHead><TableHead>PPA</TableHead><TableHead>Client</TableHead>
                <TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Surplus</TableHead>
                <TableHead className="text-right">Price</TableHead><TableHead className="text-right">Energy €</TableHead>
                <TableHead className="text-right">Buy-back €</TableHead><TableHead className="text-right">Net €</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rowsForExport.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.period}</TableCell>
                    <TableCell className="font-mono text-xs">{r.ppa_code}</TableCell>
                    <TableCell>{r.client}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.delivered_mwh)}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.surplus_export_mwh)}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.applied_price_eur_mwh)}</TableCell>
                    <TableCell className="text-right">€ {fmtNum(r.energy_cost_eur)}</TableCell>
                    <TableCell className="text-right">€ {fmtNum(r.buyback_credit_eur)}</TableCell>
                    <TableCell className="text-right font-semibold">€ {fmtNum(r.net_amount_eur)}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => downloadStatement(r)}><FileText className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
                {rowsForExport.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-10">No settlements yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </ErpLayout>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...rest } = props;
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label htmlFor={rest.name}>{label}</Label>
      <Input id={rest.name} {...rest} />
    </div>
  );
}