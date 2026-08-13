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
 * Billing runs — THIN CLIENT.
 *
 * P0-1 (audit): the calculation used to live in this file. It fetched every
 * input into the browser, computed amounts in floats with no rounding, and
 * inserted invoices one at a time with no transaction. It has moved to the
 * `billing-run` edge function; this page now only triggers it and renders the
 * result. The invoice amounts are produced by the server and cannot be
 * influenced from here — there is no longer an INSERT policy on
 * public.invoices for authenticated users.
 */
export default function BillingRuns() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("billing_runs").select("*").order("created_at", { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const create = async (form: FormData) => {
    const { error } = await supabase.from("billing_runs").insert({
      period_start: String(form.get("period_start")),
      period_end: String(form.get("period_end")),
      status: 'draft',
      scope: 'all',
      notes: form.get("notes") as string || null,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Run created"); setOpen(false); load();
  };

  const del = async (run: any) => {
    // Issued runs are protected by a database trigger as well; this is just a
    // friendlier message than the exception.
    if (run.status === 'issued') {
      return toast.error("Issued runs cannot be deleted — they are the audit trail for their invoices.");
    }
    if (!confirm("Delete this draft run and its draft invoices?")) return;
    const { error } = await supabase.from("billing_runs").delete().eq("id", run.id);
    if (error) return toast.error(error.message);
    load();
  };

  /** Calculate (or recalculate) — all arithmetic happens server-side. */
  const execute = async (run: any) => {
    setBusy(run.id);
    toast.info("Calculating on the server…");
    try {
      const { data, error } = await supabase.functions.invoke("billing-run", {
        body: { run_id: run.id, action: "preview" },
      });
      if (error) throw error;

      if (!data?.ok) {
        if (data?.error === "MISSING_MONTHLY_REGULATORY_VALUES") {
          // MEMO publishes PPEE per supplier per month. Billing on a stale
          // value silently mis-bills every MK customer, so the server refuses
          // rather than asking the operator to confirm past it.
          toast.error(data.message, { duration: 15000 });
          return;
        }
        toast.error(data?.error ?? "Billing run failed");
        return;
      }

      const warned = (data.warnings ?? []).length;
      toast.success(
        `${data.invoices} draft invoice(s) — ${fmtEur(data.total_eur)}, ${fmtNum(data.total_mwh)} MWh` +
        (data.skipped?.length ? ` · ${data.skipped.length} contract(s) skipped` : "") +
        (warned ? ` · ${warned} with warnings` : ""),
        { duration: warned ? 12000 : 5000 },
      );
      if (warned) {
        for (const w of data.warnings.slice(0, 5)) {
          toast.warning(w.warnings.join(" "), { duration: 12000 });
        }
      }
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Billing run failed");
    } finally {
      setBusy(null);
    }
  };

  /** Issue — numbers are allocated inside one database transaction. */
  const issue = async (run: any) => {
    if (!confirm(
      `Issue ${run.invoice_count} invoice(s)?\n\n` +
      `Invoice numbers are allocated now and cannot be reused. ` +
      `Issued invoices become immutable — corrections require voiding and re-issuing.`
    )) return;
    setBusy(run.id);
    try {
      const { data, error } = await supabase.functions.invoke("billing-run", {
        body: { run_id: run.id, action: "issue" },
      });
      if (error) throw error;
      if (!data?.ok) { toast.error(data?.error ?? "Issue failed"); return; }
      toast.success(`Issued ${data.issued} invoice(s)`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Issue failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ErpLayout title="Supply Billing Runs" subtitle="Generate invoices for activated supply contracts — drafts appear in the customer portal automatically"
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
                      {(r.status === 'draft' || r.status === 'preview') && <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => execute(r)}><Play className="h-3 w-3 mr-1" />{busy === r.id ? "Working…" : (r.status === 'preview' ? "Recalculate" : "Run")}</Button>}
                      {r.status === 'preview' && <Button size="sm" disabled={busy === r.id} onClick={() => issue(r)}><FileCheck2 className="h-3 w-3 mr-1" />Issue invoices</Button>}
                      {r.status !== 'issued' && <Button size="icon" variant="ghost" onClick={() => del(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
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