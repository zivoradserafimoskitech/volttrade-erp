import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";

const STATUS = ['draft','active','suspended','terminated'];

export default function SupplyContracts() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [tariffs, setTariffs] = useState<any[]>([]);
  const [mps, setMps] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [pickedMps, setPickedMps] = useState<string[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");

  const load = async () => {
    const [c, cl, t, m, l] = await Promise.all([
      supabase.from("supply_contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("clients").select("id,company_name").order("company_name"),
      supabase.from("tariffs").select("id,code,name").order("code"),
      supabase.from("metering_points").select("id,edu_code,client_id"),
      supabase.from("supply_contract_points").select("*"),
    ]);
    setRows(c.data ?? []); setClients(cl.data ?? []); setTariffs(t.data ?? []); setMps(m.data ?? []); setLinks(l.data ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const add = async (form: FormData) => {
    const { data: created, error } = await supabase.from("supply_contracts").insert({
      user_id: user!.id,
      contract_number: String(form.get("contract_number")),
      client_id: String(form.get("client_id")),
      tariff_id: form.get("tariff_id") || null,
      start_date: String(form.get("start_date")),
      end_date: form.get("end_date") || null,
      annual_volume_mwh: Number(form.get("annual_volume_mwh") || 0),
      payment_terms_days: Number(form.get("payment_terms_days") || 14),
      status: String(form.get("status") || 'draft'),
      auto_renew: form.get("auto_renew") === 'on',
      notes: form.get("notes") as string || null,
    } as any).select().single();
    if (error || !created) return toast.error(error?.message ?? 'Failed');
    if (pickedMps.length) {
      const { error: e2 } = await supabase.from("supply_contract_points").insert(pickedMps.map(mid => ({ contract_id: created.id, metering_point_id: mid })));
      if (e2) toast.error(e2.message);
    }
    toast.success("Contract created"); setOpen(false); setPickedMps([]); setSelectedClient(""); load();
  };
  const del = async (id: string) => { if (!confirm("Delete?")) return; await supabase.from("supply_contracts").delete().eq("id", id); load(); };

  const clientMps = mps.filter(m => m.client_id === selectedClient);

  return (
    <ErpLayout title="Supply Contracts" subtitle="Customer agreements linking supply points to tariffs"
      actions={
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setPickedMps([]); setSelectedClient(""); } }}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New contract</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New supply contract</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <F name="contract_number" label="Contract number" required placeholder="SC-2026-001" />
              <div className="space-y-2"><Label>Status</Label>
                <Select name="status" defaultValue="draft"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-2 col-span-2"><Label>Customer</Label>
                <Select name="client_id" required value={selectedClient} onValueChange={setSelectedClient}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-2 col-span-2"><Label>Tariff</Label>
                <Select name="tariff_id"><SelectTrigger><SelectValue placeholder="Select tariff (optional)" /></SelectTrigger>
                  <SelectContent>{tariffs.map(t => <SelectItem key={t.id} value={t.id}>{t.code} — {t.name}</SelectItem>)}</SelectContent></Select>
              </div>
              <F name="start_date" label="Start date" type="date" required />
              <F name="end_date" label="End date" type="date" />
              <F name="annual_volume_mwh" label="Annual volume (MWh)" type="number" step="0.01" />
              <F name="payment_terms_days" label="Payment terms (days)" type="number" defaultValue="14" />
              <div className="space-y-2 col-span-2">
                <Label>Auto-renew</Label>
                <label className="flex items-center gap-2 text-sm h-10"><input type="checkbox" name="auto_renew" /> Renew automatically at end date</label>
              </div>
              {selectedClient && (
                <div className="col-span-2 space-y-2">
                  <Label>Supply points to include ({pickedMps.length} selected)</Label>
                  <div className="border border-border/60 rounded-md max-h-32 overflow-auto p-2 space-y-1">
                    {clientMps.length === 0 && <div className="text-xs text-muted-foreground p-2">No supply points for this customer yet.</div>}
                    {clientMps.map(m => (
                      <label key={m.id} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={pickedMps.includes(m.id)} onChange={(e) => setPickedMps(e.target.checked ? [...pickedMps, m.id] : pickedMps.filter(x => x !== m.id))} />
                        <span className="font-mono">{m.edu_code}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Save contract</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <Card className="border-border/60"><CardHeader><CardTitle>Contracts ({rows.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Number</TableHead><TableHead>Customer</TableHead><TableHead>Tariff</TableHead><TableHead>Period</TableHead><TableHead className="text-right">Annual MWh</TableHead><TableHead>Supply points</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(c => {
                const cli = clients.find(x => x.id === c.client_id);
                const t = tariffs.find(x => x.id === c.tariff_id);
                const pts = links.filter(l => l.contract_id === c.id);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.contract_number}</TableCell>
                    <TableCell>{cli?.company_name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{t ? `${t.code}` : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.start_date} → {c.end_date ?? '∞'}</TableCell>
                    <TableCell className="text-right">{fmtNum(c.annual_volume_mwh)}</TableCell>
                    <TableCell className="text-xs">{pts.length}</TableCell>
                    <TableCell><Badge variant={c.status==='active'?'default':'secondary'}>{c.status}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => del(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">No contracts yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function F(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...rest } = props;
  return <div className={`space-y-2 ${className ?? ""}`}><Label htmlFor={rest.name}>{label}</Label><Input id={rest.name} {...rest} /></div>;
}