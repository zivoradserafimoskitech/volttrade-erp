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
import { Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

type Mp = any; type Client = { id: string; company_name: string };

export default function SupplyPoints() {
  const { user } = useAuth();
  const [mps, setMps] = useState<Mp[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const load = async () => {
    const { data: ms } = await supabase.from("metering_points").select("*").order("edu_code");
    const { data: cs } = await supabase.from("clients").select("id,company_name").order("company_name");
    setMps(ms ?? []); setClients((cs as any) ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const add = async (form: FormData) => {
    const { error } = await supabase.from("metering_points").insert({
      client_id: String(form.get("client_id")),
      edu_code: String(form.get("edu_code")),
      address: form.get("address") as string || null,
      voltage_level: form.get("voltage_level") as string || null,
      annual_consumption_mwh: form.get("annual_consumption_mwh") ? Number(form.get("annual_consumption_mwh")) : null,
      dso_area: form.get("dso_area") as string || null,
      capacity_kw: form.get("capacity_kw") ? Number(form.get("capacity_kw")) : null,
      connection_type: form.get("connection_type") as string || null,
      meter_id: form.get("meter_id") as string || null,
      status: 'active',
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Supply point added"); setOpen(false); load();
  };

  const del = async (id: string) => { if (!confirm("Delete?")) return; const { error } = await supabase.from("metering_points").delete().eq("id", id); if (error) return toast.error(error.message); load(); };

  const filtered = mps.filter(m => !filter || m.edu_code?.toLowerCase().includes(filter.toLowerCase()) || m.address?.toLowerCase().includes(filter.toLowerCase()));

  return (
    <ErpLayout title="Supply Points" subtitle="Metering points (EDU/POD) connected to customer contracts"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />Add supply point</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New supply point</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Customer</Label>
                <Select name="client_id" required><SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <F name="edu_code" label="EDU / POD code" required className="col-span-2" placeholder="HU000120F11-U-XXXXXX" />
              <F name="address" label="Address" className="col-span-2" />
              <F name="dso_area" label="DSO area" />
              <F name="voltage_level" label="Voltage level" placeholder="LV / MV / HV" />
              <F name="connection_type" label="Connection type" placeholder="3-phase / 1-phase" />
              <F name="capacity_kw" label="Capacity (kW)" type="number" step="0.01" />
              <F name="meter_id" label="Meter ID" />
              <F name="annual_consumption_mwh" label="Annual consumption (MWh)" type="number" step="0.01" />
              <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Save</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <div className="flex items-center gap-2"><Input placeholder="Search EDU code or address…" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" /></div>
      <Card className="border-border/60"><CardHeader><CardTitle>Supply points ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>EDU / POD</TableHead><TableHead>Customer</TableHead><TableHead>DSO</TableHead><TableHead>Voltage</TableHead><TableHead className="text-right">Capacity</TableHead><TableHead className="text-right">Annual MWh</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(m => {
                const client = clients.find(c => c.id === m.client_id);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs"><Badge variant="outline"><Zap className="h-3 w-3 mr-1" />{m.edu_code}</Badge></TableCell>
                    <TableCell className="text-sm">{client?.company_name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.dso_area ?? "—"}</TableCell>
                    <TableCell className="text-sm">{m.voltage_level ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">{m.capacity_kw ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">{m.annual_consumption_mwh ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{m.status}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => del(m.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">No supply points yet.</TableCell></TableRow>}
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