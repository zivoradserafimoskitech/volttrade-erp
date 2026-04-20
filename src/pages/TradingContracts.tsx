import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Trash2, FileSignature } from "lucide-react";

type Tc = { id: string; counterparty_id: string; contract_number: string; contract_type: string; start_date: string; end_date: string|null; signed_date: string|null; currency: string; status: string };
type Cp = { id: string; legal_name: string };

const TYPES = ["EFET","PPA","bilateral","balancing","tolling","supply"];
const STATUSES = ["draft","active","expired","terminated"];

export default function TradingContracts() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Tc[]>([]);
  const [cps, setCps] = useState<Cp[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("trading_contracts").select("*").order("start_date", { ascending: false });
    const { data: c } = await supabase.from("counterparties").select("id,legal_name").order("legal_name");
    setRows((data as any) ?? []); setCps((c as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const add = async (form: FormData) => {
    const { error } = await supabase.from("trading_contracts").insert({
      user_id: user!.id,
      counterparty_id: String(form.get("counterparty_id")),
      contract_number: String(form.get("contract_number")),
      contract_type: String(form.get("contract_type")),
      start_date: String(form.get("start_date")),
      end_date: form.get("end_date") || null,
      signed_date: form.get("signed_date") || null,
      currency: String(form.get("currency") || "EUR"),
      status: String(form.get("status") || "draft"),
      notes: form.get("notes") || null,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Contract created"); setOpen(false); load();
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("trading_contracts").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete contract?")) return;
    await supabase.from("trading_contracts").delete().eq("id", id); load();
  };

  const cpName = (id: string) => cps.find(c => c.id === id)?.legal_name ?? "—";

  return (
    <ErpLayout title="Trading Contracts" subtitle="Master agreements: EFET, PPA, bilateral, balancing"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New contract</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New trading contract</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Counterparty</Label>
                <Select name="counterparty_id" required>
                  <SelectTrigger><SelectValue placeholder="Select counterparty" /></SelectTrigger>
                  <SelectContent>{cps.map(c => <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Contract number</Label><Input name="contract_number" required /></div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select name="contract_type" defaultValue="bilateral">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Start date</Label><Input name="start_date" type="date" required /></div>
              <div className="space-y-2"><Label>End date</Label><Input name="end_date" type="date" /></div>
              <div className="space-y-2"><Label>Signed date</Label><Input name="signed_date" type="date" /></div>
              <div className="space-y-2"><Label>Currency</Label><Input name="currency" defaultValue="EUR" /></div>
              <div className="space-y-2 col-span-2">
                <Label>Status</Label>
                <Select name="status" defaultValue="draft">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Button type="submit" className="w-full" style={{ background: "var(--gradient-primary)" }}>Save</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <Card className="border-border/60">
        <CardHeader><CardTitle className="flex items-center gap-2"><FileSignature className="h-4 w-4" />All contracts</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Number</TableHead><TableHead>Counterparty</TableHead><TableHead>Type</TableHead>
              <TableHead>Validity</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.contract_number}</TableCell>
                  <TableCell>{cpName(r.counterparty_id)}</TableCell>
                  <TableCell><Badge variant="outline">{r.contract_type.toUpperCase()}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.start_date} → {r.end_date ?? "open"}</TableCell>
                  <TableCell>
                    <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v)}>
                      <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">No contracts yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}
