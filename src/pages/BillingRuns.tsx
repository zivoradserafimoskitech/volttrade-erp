import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Plus, Play, FileCheck2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtEur, fmtNum } from "@/lib/format";

/**
 * Simplified billing engine:
 * - For each contract, sum validated meter readings (import_kwh) in [period_start, period_end]
 * - Apply tariff energy_price (€/MWh) and monthly fixed_fee
 * - Apply VAT from country (defaults to 0 if no country); store invoice
 */
export default function BillingRuns() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => { const { data } = await supabase.from("billing_runs").select("*").order("created_at", { ascending: false }); setRows(data ?? []); };
  useEffect(() => { if (user) load(); }, [user]);

  const create = async (form: FormData) => {
    const { error } = await supabase.from("billing_runs").insert({
      user_id: user!.id,
      period_start: String(form.get("period_start")),
      period_end: String(form.get("period_end")),
      status: 'draft',
      scope: 'all',
      notes: form.get("notes") as string || null,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Run created"); setOpen(false); load();
  };

  const del = async (id: string) => { if (!confirm("Delete run?")) return; await supabase.from("billing_runs").delete().eq("id", id); load(); };

  const execute = async (run: any) => {
    toast.info("Calculating…");
    const { data: contracts } = await supabase.from("supply_contracts").select("*").eq("status", "active");
    const { data: tariffs } = await supabase.from("tariffs").select("*");
    const { data: clients } = await supabase.from("clients").select("id,country_code");
    const { data: countries } = await supabase.from("countries").select("code,vat_percent");
    const { data: links } = await supabase.from("supply_contract_points").select("*");
    const { data: readings } = await supabase.from("meter_readings").select("*").eq("validation_status", "validated").gte("reading_at", run.period_start).lte("reading_at", run.period_end + "T23:59:59");

    let invoiceCount = 0, totalEur = 0, totalMwh = 0;
    for (const c of (contracts ?? [])) {
      const t = (tariffs ?? []).find((x: any) => x.id === c.tariff_id);
      if (!t) continue;
      const energy = (t.components ?? []).find((x: any) => x.type === 'energy')?.value ?? 0;
      const fixed = (t.components ?? []).find((x: any) => x.type === 'fixed_fee')?.value ?? 0;
      const mpIds = (links ?? []).filter((l: any) => l.contract_id === c.id).map((l: any) => l.metering_point_id);
      const kwh = (readings ?? []).filter((r: any) => mpIds.includes(r.metering_point_id)).reduce((s: number, r: any) => s + Number(r.import_kwh || 0), 0);
      const mwh = kwh / 1000;
      const energy_amount = mwh * Number(energy);
      const subtotal = energy_amount + Number(fixed);
      const country = (clients ?? []).find((x: any) => x.id === c.client_id)?.country_code;
      const vatPct = (countries ?? []).find((x: any) => x.code === country)?.vat_percent ?? 0;
      const tax = subtotal * Number(vatPct) / 100;
      const total = subtotal + tax;
      const invoice_number = `INV-${run.period_start.slice(0,7)}-${c.contract_number}`;
      const components = [
        { type: 'energy', label: 'Energy supply', mwh, price_eur_mwh: Number(energy), amount_eur: energy_amount },
        { type: 'fixed_fee', label: 'Monthly fixed fee', amount_eur: Number(fixed) },
        { type: 'vat', label: `VAT ${vatPct}%`, amount_eur: tax },
      ];
      const due = new Date(run.period_end); due.setDate(due.getDate() + (c.payment_terms_days ?? 14));
      const { error } = await supabase.from("invoices").insert({
        user_id: user!.id, client_id: c.client_id, billing_run_id: run.id,
        invoice_number, period_start: run.period_start, period_end: run.period_end,
        total_mwh: mwh, energy_amount_eur: energy_amount, margin_amount_eur: 0,
        total_eur: total, tax_amount_eur: tax, currency: 'EUR',
        components, due_date: due.toISOString().slice(0,10),
        status: 'draft', doc_type: 'invoice',
      } as any);
      if (!error) { invoiceCount++; totalEur += total; totalMwh += mwh; }
    }
    await supabase.from("billing_runs").update({ status: 'preview', invoice_count: invoiceCount, total_eur: totalEur, total_mwh: totalMwh }).eq("id", run.id);
    toast.success(`Generated ${invoiceCount} draft invoices`);
    load();
  };

  const issue = async (run: any) => {
    await supabase.from("invoices").update({ status: 'issued' }).eq("billing_run_id", run.id);
    await supabase.from("billing_runs").update({ status: 'issued' }).eq("id", run.id);
    toast.success("Invoices issued"); load();
  };

  return (
    <ErpLayout title="Billing Runs" subtitle="Generate monthly invoices from validated meter readings"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New billing run</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New billing run</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); create(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <F name="period_start" label="Period start" type="date" required />
              <F name="period_end" label="Period end" type="date" required />
              <F name="notes" label="Notes" className="col-span-2" />
              <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Create draft run</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <Card className="border-border/60"><CardHeader><CardTitle>Runs ({rows.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Total MWh</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                  <TableCell><Badge variant={r.status==='issued'?'default':'secondary'}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right">{r.invoice_count}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.total_mwh)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtEur(r.total_eur)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {r.status === 'draft' && <Button size="sm" variant="outline" onClick={() => execute(r)}><Play className="h-3 w-3 mr-1" />Run</Button>}
                      {r.status === 'preview' && <Button size="sm" onClick={() => issue(r)}><FileCheck2 className="h-3 w-3 mr-1" />Issue invoices</Button>}
                      <Button size="icon" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">No billing runs yet.</TableCell></TableRow>}
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