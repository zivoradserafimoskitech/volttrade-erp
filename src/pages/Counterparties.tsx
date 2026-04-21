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
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { fmtEur } from "@/lib/format";
import { Plus, Trash2, Building2 } from "lucide-react";

type Cp = { id: string; legal_name: string; short_name: string|null; country_code: string|null; eic_code: string|null; vat_number: string|null; contact_email: string|null; payment_terms_days: number; credit_limit_eur: number; risk_status: string; status: string };

export default function Counterparties() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Cp[]>([]);
  const [exposures, setExposures] = useState<Record<string, number>>({});
  const [countries, setCountries] = useState<{code:string;name:string}[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("counterparties").select("*").order("legal_name");
    const { data: cs } = await supabase.from("countries").select("code,name").order("name");
    const { data: trades } = await supabase.from("trades").select("counterparty_id,side,total_value_eur,status").in("status",["confirmed","nominated"]);
    const exp: Record<string, number> = {};
    (trades ?? []).forEach((t: any) => {
      if (!t.counterparty_id) return;
      const sign = t.side === "buy" ? 1 : -1;
      exp[t.counterparty_id] = (exp[t.counterparty_id] ?? 0) + sign * Number(t.total_value_eur ?? 0);
    });
    setExposures(exp);
    setRows((data as any) ?? []);
    setCountries((cs as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const add = async (form: FormData) => {
    const { error } = await supabase.from("counterparties").insert({
      user_id: user!.id,
      legal_name: String(form.get("legal_name")),
      short_name: form.get("short_name") || null,
      country_code: form.get("country_code") || null,
      eic_code: form.get("eic_code") || null,
      vat_number: form.get("vat_number") || null,
      contact_name: form.get("contact_name") || null,
      contact_email: form.get("contact_email") || null,
      contact_phone: form.get("contact_phone") || null,
      payment_terms_days: Number(form.get("payment_terms_days") || 14),
      credit_limit_eur: Number(form.get("credit_limit_eur") || 0),
      risk_status: String(form.get("risk_status") || "normal"),
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Counterparty added"); setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this counterparty?")) return;
    const { error } = await supabase.from("counterparties").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <ErpLayout title="Counterparties" subtitle="Trading partners with EIC codes, credit limits and exposure"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New counterparty</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New counterparty</DialogTitle></DialogHeader>
            <form
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const t = e.target as HTMLElement;
                  const isSubmit = t.tagName === "BUTTON" && (t as HTMLButtonElement).type === "submit";
                  if (t.tagName !== "TEXTAREA" && !isSubmit) e.preventDefault();
                }
              }}
              onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }}
              className="grid grid-cols-2 gap-3"
            >
              <Field name="legal_name" label="Legal name" required className="col-span-2" />
              <Field name="short_name" label="Short name" />
              <div className="space-y-2">
                <Label>Country</Label>
                <Select name="country_code">
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{countries.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Field name="eic_code" label="EIC code" placeholder="10X..." />
              <Field name="vat_number" label="VAT number" />
              <Field name="contact_name" label="Contact name" />
              <Field name="contact_email" label="Contact email" type="email" />
              <Field name="contact_phone" label="Contact phone" />
              <Field name="payment_terms_days" label="Payment terms (days)" type="number" defaultValue="14" />
              <Field name="credit_limit_eur" label="Credit limit (€)" type="number" step="0.01" defaultValue="0" />
              <div className="space-y-2">
                <Label>Risk status</Label>
                <Select name="risk_status" defaultValue="normal">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="watch">Watch</SelectItem>
                    <SelectItem value="restricted">Restricted</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Button type="submit" className="w-full" style={{ background: "var(--gradient-primary)" }}>Save</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <Card className="border-border/60">
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" />All counterparties</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Legal name</TableHead><TableHead>Country</TableHead><TableHead>EIC</TableHead>
              <TableHead className="text-right">Credit limit</TableHead><TableHead className="text-right">Exposure</TableHead>
              <TableHead className="w-40">Utilization</TableHead><TableHead>Risk</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => {
                const exp = exposures[r.id] ?? 0;
                const limit = Number(r.credit_limit_eur);
                const util = limit > 0 ? Math.min(100, Math.abs(exp) / limit * 100) : 0;
                const over = limit > 0 && Math.abs(exp) > limit;
                return (
                  <TableRow key={r.id}>
                    <TableCell><div className="font-medium">{r.legal_name}</div>{r.short_name && <div className="text-xs text-muted-foreground">{r.short_name}</div>}</TableCell>
                    <TableCell>{r.country_code ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.eic_code ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmtEur(limit)}</TableCell>
                    <TableCell className={`text-right ${over ? "text-destructive font-semibold" : ""}`}>{fmtEur(exp)}</TableCell>
                    <TableCell><Progress value={util} className={over ? "[&>div]:bg-destructive" : ""} /></TableCell>
                    <TableCell><Badge variant={r.risk_status === "normal" ? "secondary" : "destructive"}>{r.risk_status}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">No counterparties yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function Field({ label, className, ...props }: any) {
  return <div className={`space-y-2 ${className ?? ""}`}><Label>{label}</Label><Input {...props} /></div>;
}
