import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { fmtEur, fmtMwh } from "@/lib/format";
import { FileDown, FileSpreadsheet, Trash2, Send, BellRing, AlertTriangle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { renderInvoicePdf, detectInvoiceLang, type InvoiceLang } from "@/lib/invoiceTemplates";

type Client = { id: string; company_name: string; contract_type: string; fixed_price_eur_mwh: number | null; margin_eur_mwh: number; country_code: string | null };
type Invoice = {
  id: string; invoice_number: string; period_start: string; period_end: string; total_mwh: number;
  energy_amount_eur: number; margin_amount_eur: number; total_eur: number; paid_amount_eur: number | null;
  due_date: string | null; status: string; client_id: string;
  sent_at: string | null; sent_count: number | null;
  last_reminder_at: string | null; reminder_count: number | null;
  dunning_level: number | null; last_dunning_at: string | null;
};
type NoticeKind = "invoice" | "reminder" | "dunning";

export default function Invoices() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [lang, setLang] = useState<InvoiceLang | "auto">("auto");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data: cs } = await supabase.from("clients").select("id, company_name, contract_type, fixed_price_eur_mwh, margin_eur_mwh, country_code");
    const { data: inv } = await supabase.from("invoices").select("*").order("created_at", { ascending: false });
    setClients((cs as any) ?? []); setInvoices((inv as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const todayISO = new Date().toISOString().slice(0, 10);
  const unsent = invoices.filter(i => !i.sent_at && i.status !== "draft");
  const overdue = invoices.filter(i => i.status !== "paid" && i.due_date && i.due_date < todayISO
    && Number(i.total_eur ?? 0) - Number(i.paid_amount_eur ?? 0) > 0.009);

  const sendNotices = async (kind: NoticeKind, invoiceIds?: string[], busyKey: string = kind) => {
    setBusy(busyKey);
    try {
      const { data, error } = await supabase.functions.invoke("send-invoice-notices", {
        body: { kind, language: lang, invoice_ids: invoiceIds ?? null },
      });
      if (error) throw error;
      const res = data as { processed: number; skipped: number; results?: { invoice: string; status: string; detail?: string }[] };
      const labels: Record<NoticeKind, string> = { invoice: "invoices", reminder: "reminders", dunning: "final notices" };
      if (res.processed > 0) toast.success(`Sent ${res.processed} ${labels[kind]}${res.skipped ? ` · skipped ${res.skipped}` : ""}`);
      else toast.warning(res.skipped ? `Nothing sent — ${res.skipped} skipped. ${res.results?.[0]?.detail ?? ""}` : "Nothing to send.");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Sending failed");
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = async (inv: Invoice) => {
    const client = clients.find(c => c.id === inv.client_id);
    if (!client) { toast.error("Client not found"); return; }
    const { data: meters } = await supabase.from("metering_points").select("id, edu_code, address").eq("client_id", inv.client_id);
    const meterIds = (meters ?? []).map((m: any) => m.id);
    const startISO = new Date(inv.period_start).toISOString();
        const endISO = new Date(new Date(inv.period_end).getTime() + 24*3600*1000 - 1).toISOString();
    const { data: readings } = meterIds.length
      ? await supabase.from("consumption_readings").select("reading_at, actual_mwh, metering_point_id")
          .in("metering_point_id", meterIds).gte("reading_at", startISO).lte("reading_at", endISO)
      : { data: [] as any[] };
    await renderInvoicePdf({
      inv, client,
      meters: (meters ?? []) as any,
      readings: (readings ?? []) as any,
      lang: lang === "auto" ? detectInvoiceLang(client.country_code) : lang,
    });
  };

  const exportExcel = async () => {
    const { data: readings } = await supabase.from("consumption_readings").select("reading_at, forecast_mwh, actual_mwh, metering_point:metering_points(edu_code, client:clients(company_name))").order("reading_at", { ascending: false }).limit(5000);
    const rows = (readings ?? []).map((r: any) => ({
      Timestamp: r.reading_at, Client: r.metering_point?.client?.company_name, EDU: r.metering_point?.edu_code,
      "Forecast MWh": Number(r.forecast_mwh ?? 0), "Actual MWh": Number(r.actual_mwh ?? 0),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Energy Report");
    XLSX.writeFile(wb, `energy-report-${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  return (
    <ErpLayout title="Billing & Invoicing" subtitle="Invoice register — status, PDF and Excel exports"
      actions={
        <div className="flex items-center gap-2">
          <Select value={lang} onValueChange={(v) => setLang(v as any)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Invoice language" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (by country)</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="mk">Македонски</SelectItem>
              <SelectItem value="sq">Shqip</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="secondary" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 mr-2" />Export Excel report</Button>
        </div>
      }>
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Send to end customers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy !== null || unsent.length === 0}
            onClick={() => sendNotices("invoice")}
            style={{ background: "var(--gradient-primary)" }}>
            {busy === "invoice" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Send all unsent ({unsent.length})
          </Button>
          <Button variant="secondary" disabled={busy !== null || overdue.length === 0} onClick={() => sendNotices("reminder")}>
            {busy === "reminder" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BellRing className="h-4 w-4 mr-2" />}
            Payment reminder ({overdue.length})
          </Button>
          <Button variant="outline" className="border-destructive/50 text-destructive hover:text-destructive"
            disabled={busy !== null || overdue.length === 0} onClick={() => sendNotices("dunning")}>
            {busy === "dunning" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
            Final notice ({overdue.length})
          </Button>
          <span className="text-xs text-muted-foreground">
            Notices are delivered in the customer portal (Vatra) in Macedonian, Albanian or English — based on the customer country or the language selected above.
          </span>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="py-3 text-sm text-muted-foreground">
          Invoices are generated by <a href="/billing" className="text-primary underline">Supply Billing Runs</a> (contracts × tariffs × validated consumption). This page is the invoice register: status, PDF and Excel export.
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Invoices ({invoices.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Number</TableHead><TableHead>Client</TableHead><TableHead>Period</TableHead>
              <TableHead className="text-right">Volume</TableHead><TableHead className="text-right">Energy</TableHead>
              <TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead><TableHead>Sent</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {invoices.map(inv => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                  <TableCell>{clients.find(c => c.id === inv.client_id)?.company_name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{inv.period_start} → {inv.period_end}</TableCell>
                  <TableCell className="text-right">{fmtMwh(inv.total_mwh)}</TableCell>
                  <TableCell className="text-right">{fmtEur(inv.energy_amount_eur)}</TableCell>
                  <TableCell className="text-right">{fmtEur(inv.margin_amount_eur)}</TableCell>
                  <TableCell className="text-right font-semibold text-primary">{fmtEur(inv.total_eur)}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{inv.status}</Badge></TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-wrap items-center gap-1">
                      {inv.sent_at
                        ? <Badge variant="secondary">Фактура {format(new Date(inv.sent_at), "dd.MM.yy")}</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">Непратена</Badge>}
                      {Number(inv.reminder_count ?? 0) > 0 && <Badge variant="secondary">Reminder ×{inv.reminder_count}</Badge>}
                      {Number(inv.dunning_level ?? 0) > 0 && <Badge variant="destructive">Notice level {inv.dunning_level}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Send invoice" disabled={busy !== null}
                        onClick={() => sendNotices("invoice", [inv.id], `inv-${inv.id}`)}><Send className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" title="Payment reminder" disabled={busy !== null}
                        onClick={() => sendNotices("reminder", [inv.id], `rem-${inv.id}`)}><BellRing className="h-4 w-4 text-amber-500" /></Button>
                      <Button size="icon" variant="ghost" title="Final notice" disabled={busy !== null}
                        onClick={() => sendNotices("dunning", [inv.id], `dun-${inv.id}`)}><AlertTriangle className="h-4 w-4 text-destructive" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => exportPdf(inv)}><FileDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={async () => { await supabase.from("invoices").delete().eq("id", inv.id); load(); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-10">No invoices yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}