import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtEur } from "@/lib/format";
import { ArrowLeft, Clock } from "lucide-react";

type Inv = { id: string; invoice_number: string; client_id: string; total_eur: number; paid_amount_eur: number; due_date: string|null; status: string; period_end: string };
type Client = { id: string; company_name: string; payment_terms_days: number };

function inBucket(daysOverdue: number, bucket: string): boolean {
  if (bucket === "Current") return daysOverdue <= 0;
  if (bucket === "1-30") return daysOverdue >= 1 && daysOverdue <= 30;
  if (bucket === "31-60") return daysOverdue >= 31 && daysOverdue <= 60;
  if (bucket === "61-90") return daysOverdue >= 61 && daysOverdue <= 90;
  if (bucket === "90+") return daysOverdue > 90;
  return false;
}

export default function AgingDrill() {
  const { bucket: bucketRaw } = useParams<{ bucket: string }>();
  const bucket = decodeURIComponent(bucketRaw ?? "");
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    (async () => {
      const [iR, cR] = await Promise.all([
        supabase.from("invoices").select("id,invoice_number,client_id,total_eur,paid_amount_eur,due_date,status,period_end").limit(1000),
        supabase.from("clients").select("id,company_name,payment_terms_days"),
      ]);
      setInvoices((iR.data as any) ?? []);
      setClients((cR.data as any) ?? []);
    })();
  }, []);

  const clientMap = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);

  const rows = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: any[] = [];
    for (const inv of invoices) {
      if (inv.status === "cancelled" || inv.status === "draft") continue;
      const outstanding = Number(inv.total_eur) - Number(inv.paid_amount_eur);
      if (outstanding <= 0.01) continue;
      let due: Date;
      if (inv.due_date) due = new Date(inv.due_date);
      else {
        const cl = clientMap.get(inv.client_id);
        due = new Date(inv.period_end);
        due.setDate(due.getDate() + (cl?.payment_terms_days ?? 14));
      }
      const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
      if (!inBucket(days, bucket)) continue;
      out.push({
        ...inv, outstanding, days_overdue: days,
        client_name: clientMap.get(inv.client_id)?.company_name ?? "—",
        due_effective: due.toISOString().slice(0, 10),
      });
    }
    return out.sort((a, b) => b.days_overdue - a.days_overdue);
  }, [invoices, clientMap, bucket]);

  const total = rows.reduce((s, r) => s + r.outstanding, 0);

  return (
    <ErpLayout title={`Debt Aging — ${bucket} days`} subtitle={`${rows.length} invoices · ${fmtEur(total)} outstanding`}
      actions={<Button asChild variant="outline" size="sm"><Link to="/risk"><ArrowLeft className="h-3 w-3 mr-1" />Back to Risk</Link></Button>}>
      <RoleGate roles={["risk_officer", "management", "admin", "finance"]}>
        <Card className="border-border/60">
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" />Outstanding invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice</TableHead><TableHead>Customer</TableHead>
                <TableHead>Period end</TableHead><TableHead>Effective due</TableHead>
                <TableHead className="text-right">Days overdue</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                    <TableCell>{r.client_name}</TableCell>
                    <TableCell className="text-xs">{r.period_end}</TableCell>
                    <TableCell className="text-xs">{r.due_effective}</TableCell>
                    <TableCell className={`text-right font-mono ${r.days_overdue > 60 ? "text-destructive" : r.days_overdue > 0 ? "text-warning" : "text-muted-foreground"}`}>{r.days_overdue}</TableCell>
                    <TableCell className="text-right font-mono">{fmtEur(r.total_eur)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{fmtEur(r.paid_amount_eur)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{fmtEur(r.outstanding)}</TableCell>
                    <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-10 text-sm text-muted-foreground">No invoices in this bucket.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </RoleGate>
    </ErpLayout>
  );
}