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
import { SUPPORTED_CURRENCIES, formatMoney } from "@/lib/fx";

type Tariff = any;
const MODELS = [
  { v: 'fixed', l: 'Fixed price' },
  { v: 'indexed', l: 'Market-indexed' },
  { v: 'tou', l: 'Time-of-use' },
  { v: 'block', l: 'Block tariff' },
  { v: 'custom', l: 'Custom industrial' },
];

export default function Tariffs() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Tariff[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => { const { data } = await supabase.from("tariffs").select("*").order("created_at", { ascending: false }); setRows(data ?? []); };
  useEffect(() => { if (user) load(); }, [user]);

  const add = async (form: FormData) => {
    const energyPrice = Number(form.get("energy_price") || 0);
    const fixedFee = Number(form.get("fixed_fee") || 0);
    const marginV = Number(form.get("margin") || 0);
    const freeBelowRaw = form.get("free_below");
    const components = [
      { type: 'energy', label: 'Energy (€/MWh)', unit: '€/MWh', value: energyPrice },
      { type: 'fixed_fee', label: 'Monthly fixed fee', unit: '€/month', value: fixedFee },
      ...(marginV ? [{ type: 'margin', label: 'Supplier margin (€/MWh)', unit: '€/MWh', value: marginV }] : []),
      // Free-hours product: intervals with market price ≤ this threshold are billed at 0
      ...(freeBelowRaw !== null && freeBelowRaw !== '' ? [{ type: 'free_below', label: 'Free when market price ≤ (€/MWh)', unit: '€/MWh', value: Number(freeBelowRaw) }] : []),
    ];
    const { error } = await supabase.from("tariffs").insert({
      user_id: user!.id,
      code: String(form.get("code")), name: String(form.get("name")),
      model: String(form.get("model")), currency: String(form.get("currency") || 'EUR'),
      valid_from: String(form.get("valid_from")), valid_to: form.get("valid_to") || null,
      customer_segment: form.get("customer_segment") as string || null,
      vat_included: form.get("vat_included") === 'on',
      components, status: 'active',
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Tariff created"); setOpen(false); load();
  };

  const del = async (id: string) => { if (!confirm("Delete?")) return; const { error } = await supabase.from("tariffs").delete().eq("id", id); if (error) return toast.error(error.message); load(); };

  return (
    <ErpLayout title="Tariffs & Pricing" subtitle="Versioned tariff plans applied to supply contracts"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New tariff</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New tariff</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <F name="code" label="Tariff code" required placeholder="IND-2026-Q1" />
              <F name="name" label="Name" required placeholder="Industrial Q1 2026" />
              <div className="space-y-2"><Label>Model</Label>
                <Select name="model" defaultValue="fixed"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MODELS.map(m => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Currency</Label>
                <Select name="currency" defaultValue="EUR">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <F name="valid_from" label="Valid from" type="date" required />
              <F name="valid_to" label="Valid to (optional)" type="date" />
              <F name="customer_segment" label="Segment" placeholder="industrial / commercial / household" />
              <div className="space-y-2"><Label>VAT</Label>
                <label className="flex items-center gap-2 text-sm h-10"><input type="checkbox" name="vat_included" /> Prices include VAT</label>
              </div>
              <F name="energy_price" label="Energy price (/MWh, in chosen currency)" type="number" step="0.01" required />
              <F name="fixed_fee" label="Monthly fixed fee (in chosen currency)" type="number" step="0.01" defaultValue="0" />
              <F name="margin" label="Margin /MWh (indexed model)" type="number" step="0.01" defaultValue="0" />
              <F name="free_below" label="Free hours: price ≤ (/MWh, blank = off)" type="number" step="0.01" />
              <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Save tariff</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <Card className="border-border/60"><CardHeader><CardTitle>Tariffs ({rows.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Model</TableHead><TableHead>Currency</TableHead><TableHead>Segment</TableHead><TableHead>Validity</TableHead><TableHead className="text-right">Energy /MWh</TableHead><TableHead className="text-right">Fixed /mo</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(t => {
                const energy = (t.components ?? []).find((c: any) => c.type === 'energy')?.value;
                const fixed = (t.components ?? []).find((c: any) => c.type === 'fixed_fee')?.value;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell>{t.name}</TableCell>
                    <TableCell><Badge variant="outline">{t.model}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{t.currency ?? 'EUR'}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.customer_segment ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.valid_from} → {t.valid_to ?? '∞'}</TableCell>
                    <TableCell className="text-right">{energy != null ? formatMoney(Number(energy), t.currency ?? 'EUR') : '—'}</TableCell>
                    <TableCell className="text-right">{fixed != null ? formatMoney(Number(fixed), t.currency ?? 'EUR') : '—'}</TableCell>
                    <TableCell><Badge variant={t.status==='active'?'default':'secondary'}>{t.status}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => del(t.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-10 text-sm text-muted-foreground">No tariffs yet.</TableCell></TableRow>}
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