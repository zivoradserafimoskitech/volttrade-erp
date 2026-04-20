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
import { Plus, Link2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtEur } from "@/lib/format";

export default function Payments() {
  const { user } = useAuth();
  const [pays, setPays] = useState<any[]>([]);
  const [allocs, setAllocs] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [allocFor, setAllocFor] = useState<any>(null);
  const [allocAmt, setAllocAmt] = useState<Record<string, number>>({});

  const load = async () => {
    const [p, a, c, i] = await Promise.all([
      supabase.from("payments").select("*").order("paid_at", { ascending: false }),
      supabase.from("payment_allocations").select("*"),
      supabase.from("clients").select("id,company_name").order("company_name"),
      supabase.from("invoices").select("*").in("status", ["issued","draft"]).order("invoice_number"),
    ]);
    setPays(p.data ?? []); setAllocs(a.data ?? []); setClients(c.data ?? []); setInvoices(i.data ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const add = async (form: FormData) => {
    const { error } = await supabase.from("payments").insert({
      user_id: user!.id,
      client_id: String(form.get("client_id")),
      amount_eur: Number(form.get("amount_eur")),
      paid_at: String(form.get("paid_at")),
      method: String(form.get("method")),
      bank_reference: form.get("bank_reference") as string || null,
      status: 'unallocated',
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Payment recorded"); setOpen(false); load();
  };

  const allocated = (paymentId: string) => allocs.filter(a => a.payment_id === paymentId).reduce((s,a) => s + Number(a.amount_eur), 0);
  const invoiceOpen = (inv: any) => Number(inv.total_eur) - Number(inv.paid_amount_eur || 0);

  const allocate = async () => {
    if (!allocFor) return;
    const remaining = Number(allocFor.amount_eur) - allocated(allocFor.id);
    let toAlloc = Object.entries(allocAmt).filter(([,v]) => v > 0);
    const total = toAlloc.reduce((s,[,v]) => s + Number(v), 0);
    if (total > remaining + 0.01) return toast.error("Allocation exceeds remaining payment amount");
    for (const [invoice_id, amount_eur] of toAlloc) {
      const inv = invoices.find(i => i.id === invoice_id);
      const newPaid = Number(inv.paid_amount_eur || 0) + Number(amount_eur);
      const newStatus = newPaid + 0.01 >= Number(inv.total_eur) ? 'paid' : 'partially_paid';
      await supabase.from("payment_allocations").insert({ payment_id: allocFor.id, invoice_id, amount_eur: Number(amount_eur) });
      await supabase.from("invoices").update({ paid_amount_eur: newPaid, status: newStatus }).eq("id", invoice_id);
    }
    const newAllocated = allocated(allocFor.id) + total;
    const status = newAllocated + 0.01 >= Number(allocFor.amount_eur) ? 'allocated' : 'partial';
    await supabase.from("payments").update({ status }).eq("id", allocFor.id);
    toast.success("Allocated"); setAllocFor(null); setAllocAmt({}); load();
  };

  const del = async (id: string) => { if (!confirm("Delete?")) return; await supabase.from("payments").delete().eq("id", id); load(); };

  return (
    <ErpLayout title="Payments & Receivables" subtitle="Record incoming payments and allocate them to invoices"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />Record payment</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New payment</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2"><Label>Customer</Label>
                <Select name="client_id" required><SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent></Select>
              </div>
              <F name="amount_eur" label="Amount (€)" type="number" step="0.01" required />
              <F name="paid_at" label="Paid on" type="date" required defaultValue={new Date().toISOString().slice(0,10)} />
              <div className="space-y-2"><Label>Method</Label>
                <Select name="method" defaultValue="bank_transfer"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="direct_debit">Direct debit</SelectItem>
                  </SelectContent></Select>
              </div>
              <F name="bank_reference" label="Bank reference" />
              <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Save</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <Card className="border-border/60"><CardHeader><CardTitle>Payments ({pays.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Allocated</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pays.map(p => {
                const cli = clients.find(c => c.id === p.client_id);
                const al = allocated(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">{p.paid_at}</TableCell>
                    <TableCell>{cli?.company_name ?? '—'}</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline">{p.method}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.bank_reference ?? '—'}</TableCell>
                    <TableCell className="text-right font-medium">{fmtEur(p.amount_eur)}</TableCell>
                    <TableCell className="text-right">{fmtEur(al)}</TableCell>
                    <TableCell><Badge variant={p.status==='allocated'?'default':'secondary'}>{p.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {p.status !== 'allocated' && <Button size="sm" variant="outline" onClick={() => { setAllocFor(p); setAllocAmt({}); }}><Link2 className="h-3 w-3 mr-1" />Allocate</Button>}
                        <Button size="icon" variant="ghost" onClick={() => del(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {pays.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">No payments yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!allocFor} onOpenChange={(o) => !o && setAllocFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Allocate payment to invoices</DialogTitle></DialogHeader>
          {allocFor && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">Payment: <span className="font-medium text-foreground">{fmtEur(allocFor.amount_eur)}</span> · Remaining: <span className="font-medium text-foreground">{fmtEur(Number(allocFor.amount_eur) - allocated(allocFor.id))}</span></div>
              <div className="border border-border/60 rounded-md max-h-80 overflow-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Period</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Open</TableHead><TableHead className="text-right">Allocate</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {invoices.filter(i => i.client_id === allocFor.client_id && invoiceOpen(i) > 0.01).map(i => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs">{i.invoice_number}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{i.period_start} → {i.period_end}</TableCell>
                        <TableCell className="text-right text-xs">{fmtEur(i.total_eur)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtEur(invoiceOpen(i))}</TableCell>
                        <TableCell className="text-right">
                          <Input type="number" step="0.01" className="w-28 h-8 ml-auto" value={allocAmt[i.id] ?? ''} onChange={(e) => setAllocAmt({ ...allocAmt, [i.id]: Number(e.target.value) })} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {invoices.filter(i => i.client_id === allocFor.client_id && invoiceOpen(i) > 0.01).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No open invoices for this customer.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter><Button onClick={allocate} style={{ background: "var(--gradient-primary)" }}>Allocate</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}

function F(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...rest } = props;
  return <div className={`space-y-2 ${className ?? ""}`}><Label htmlFor={rest.name}>{label}</Label><Input id={rest.name} {...rest} /></div>;
}