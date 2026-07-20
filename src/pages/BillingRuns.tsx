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
    const startISO = run.period_start + "T00:00:00";
    const endISO = run.period_end + "T23:59:59";
    // Interval consumption is the billing truth (filled by Kimi sync + DSO imports). Flagged rows are excluded from billing.
    const { data: intervalsRaw } = await supabase.from("consumption_readings").select("*").gte("reading_at", startISO).lte("reading_at", endISO);
    const intervals = (intervalsRaw ?? []).filter((r: any) => (r.quality ?? "measured") !== "flagged");
    // meter_readings holds CUMULATIVE register snapshots — only usable as max−min delta, never summed.
    const { data: registers } = await supabase.from("meter_readings").select("metering_point_id, reading_at, import_kwh").eq("validation_status", "validated").gte("reading_at", startISO).lte("reading_at", endISO);
    // Hourly market prices for indexed tariffs
    const { data: prices } = await supabase.from("market_prices").select("delivery_at, price_eur_mwh").gte("delivery_at", startISO).lte("delivery_at", endISO);
    const priceMap = new Map<string, number>();
    (prices ?? []).forEach((p: any) => priceMap.set(new Date(p.delivery_at).toISOString().slice(0, 13), Number(p.price_eur_mwh)));

    const mpIntervalMwh = (mpIds: string[]) => intervals.filter((r: any) => mpIds.includes(r.metering_point_id)).reduce((s: number, r: any) => s + Number(r.actual_mwh || 0), 0);
    const mpRegisterDeltaKwh = (mpIds: string[]) => {
      let total = 0;
      for (const id of mpIds) {
        const rs = (registers ?? []).filter((r: any) => r.metering_point_id === id).map((r: any) => Number(r.import_kwh || 0)).filter((v: number) => v > 0);
        if (rs.length >= 2) total += Math.max(...rs) - Math.min(...rs);
      }
      return total;
    };
    const indexedEnergyEur = (mpIds: string[], marginEurMwh: number) => {
      let eur = 0, mwh = 0;
      for (const r of intervals.filter((x: any) => mpIds.includes(x.metering_point_id))) {
        const key = new Date(r.reading_at).toISOString().slice(0, 13);
        const p = priceMap.get(key) ?? 0;
        eur += Number(r.actual_mwh || 0) * (p + marginEurMwh);
        mwh += Number(r.actual_mwh || 0);
      }
      return { eur, mwh };
    };

    // Regulatory charges applicable to this period (RKE): PPEE %, PPEE price, MEMO fee, FX
    const { data: regs } = await (supabase.from as any)("regulatory_charges").select("*")
      .lte("valid_from", run.period_end)
      .or(`valid_to.is.null,valid_to.gte.${run.period_start}`);
    const reg = (code: string, fallback: number) => {
      const rows = ((regs ?? []) as any[]).filter((r) => r.code === code).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
      return rows.length ? Number(rows[0].value) : fallback;
    };
    const ppeePct = reg("PPEE_PERCENT", 12.96);
    const ppeePriceMkdKwh = reg("PPEE_PRICE", 5.5993826);
    const memoFeeMkdMwh = reg("MEMO_FEE", 14.1);
    const eurMkd = reg("EUR_MKD", 61.695);

    let invoiceCount = 0, totalEur = 0, totalMwh = 0, skipped = 0;
    for (const c of (contracts ?? [])) {
      const t = (tariffs ?? []).find((x: any) => x.id === c.tariff_id);
      if (!t) continue;
      const comps = (Array.isArray(t.components) ? t.components : []) as any[];
      const energyPrice = comps.find((x: any) => x.type === 'energy')?.value ?? 0;
      const fixed = comps.find((x: any) => x.type === 'fixed_fee')?.value ?? 0;
      const marginComp = comps.find((x: any) => x.type === 'margin')?.value ?? 0;
      const mpIds = (links ?? []).filter((l: any) => l.contract_id === c.id).map((l: any) => l.metering_point_id);

      let mwh: number; let marketEnergyEur: number; let priceLabel: number;
      if ((t as any).model === 'indexed') {
        const r = indexedEnergyEur(mpIds, Number(marginComp));
        mwh = r.mwh; marketEnergyEur = r.eur; priceLabel = mwh > 0 ? r.eur / mwh : 0;
      } else {
        const intervalMwh = mpIntervalMwh(mpIds);
        mwh = intervalMwh > 0 ? intervalMwh : mpRegisterDeltaKwh(mpIds) / 1000;
        marketEnergyEur = mwh * Number(energyPrice);
        priceLabel = Number(energyPrice);
      }
      if (mwh <= 0 && Number(fixed) <= 0) { skipped++; continue; }

      // MK supplier structure: delivered energy splits into market share and
      // PPEE share (renewable obligation at regulated price); MEMO market fee
      // applies to the full volume. Amounts in tariff currency.
      const cur = ((t as any).currency || 'EUR') as string;
      const mkdTo = (mkd: number) => cur === 'MKD' ? mkd : mkd / eurMkd;
      const ppeeMwh = mwh * ppeePct / 100;
      const marketMwh = mwh - ppeeMwh;
      const energy_amount = marketEnergyEur * (marketMwh / (mwh || 1));
      const ppeeAmount = mkdTo(ppeeMwh * 1000 * ppeePriceMkdKwh);
      const memoAmount = mkdTo(mwh * memoFeeMkdMwh);
      const country = (clients ?? []).find((x: any) => x.id === c.client_id)?.country_code;
      const vatPct = (countries ?? []).find((x: any) => x.code === country)?.vat_percent ?? 0;
      const vatOf = (v: number) => v * Number(vatPct) / 100;
      const subtotal = energy_amount + ppeeAmount + memoAmount + Number(fixed);
      const tax = vatOf(subtotal);
      const total = subtotal + tax;
      const { data: seqNum } = await (supabase.rpc as any)("next_invoice_number");
      const invoice_number = (seqNum as unknown as string) || `INV-${run.period_start.slice(0,7)}-${c.contract_number}`;
      const components = [
        { type: 'energy', label: (t as any).model === 'indexed' ? 'Електрична енергија — индексирана цена' : 'Електрична енергија', mwh: marketMwh, price_eur_mwh: marketMwh > 0 ? energy_amount / marketMwh : priceLabel, amount_eur: energy_amount, vat_eur: vatOf(energy_amount) },
        { type: 'ppee', label: `Обновлива Енергија (ППЕЕ) — ${ppeePct}%`, mwh: ppeeMwh, price_eur_mwh: ppeeMwh > 0 ? ppeeAmount / ppeeMwh : 0, amount_eur: ppeeAmount, vat_eur: vatOf(ppeeAmount) },
        { type: 'market_fee', label: 'Надомест за користење на пазар на електрична енергија', mwh, price_eur_mwh: mwh > 0 ? memoAmount / mwh : 0, amount_eur: memoAmount, vat_eur: vatOf(memoAmount) },
        ...(Number(fixed) > 0 ? [{ type: 'fixed_fee', label: 'Monthly fixed fee', amount_eur: Number(fixed), vat_eur: vatOf(Number(fixed)) }] : []),
        { type: 'vat', label: `ДДВ ${vatPct}%`, amount_eur: tax },
        { type: 'meta', label: `Цените се изразени во ${cur}${cur !== 'MKD' ? ` (EUR/MKD ${eurMkd})` : ''}`, amount_eur: 0 },
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
    toast.success(`Generated ${invoiceCount} draft invoices${skipped ? ` (skipped ${skipped} contracts with no consumption)` : ''}`);
    load();
  };

  const issue = async (run: any) => {
    await supabase.from("invoices").update({ status: 'issued' }).eq("billing_run_id", run.id);
    await supabase.from("billing_runs").update({ status: 'issued' }).eq("id", run.id);
    toast.success("Invoices issued"); load();
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