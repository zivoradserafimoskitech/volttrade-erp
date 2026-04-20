import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { fmtEur, fmtMwh, fmtNum } from "@/lib/format";
import { FileDown, FileSpreadsheet, Receipt, Trash2 } from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

type Client = { id: string; company_name: string; contract_type: string; fixed_price_eur_mwh: number | null; margin_eur_mwh: number };
type Invoice = { id: string; invoice_number: string; period_start: string; period_end: string; total_mwh: number; energy_amount_eur: number; margin_amount_eur: number; total_eur: number; status: string; client_id: string };

export default function Invoices() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: cs } = await supabase.from("clients").select("id, company_name, contract_type, fixed_price_eur_mwh, margin_eur_mwh");
    const { data: inv } = await supabase.from("invoices").select("*").order("created_at", { ascending: false });
    setClients((cs as any) ?? []); setInvoices((inv as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const generate = async (form: FormData) => {
    setBusy(true);
    try {
      const client_id = String(form.get("client_id"));
      const period_start = String(form.get("period_start"));
      const period_end = String(form.get("period_end"));
      const client = clients.find(c => c.id === client_id);
      if (!client) throw new Error("Pick a client");

      // Fetch readings for client's meters in period
      const { data: meters } = await supabase.from("metering_points").select("id").eq("client_id", client_id);
      const meterIds = (meters ?? []).map((m: any) => m.id);
      if (!meterIds.length) throw new Error("Client has no metering points");

      const startISO = new Date(period_start).toISOString();
      const endISO = new Date(new Date(period_end).getTime() + 24*3600*1000 - 1).toISOString();

      const { data: readings } = await supabase.from("consumption_readings")
        .select("reading_at, actual_mwh")
        .in("metering_point_id", meterIds)
        .gte("reading_at", startISO).lte("reading_at", endISO);

      const { data: prices } = await supabase.from("market_prices")
        .select("delivery_at, price_eur_mwh")
        .gte("delivery_at", startISO).lte("delivery_at", endISO);

      const priceMap = new Map<string, number>();
      (prices ?? []).forEach((p: any) => priceMap.set(new Date(p.delivery_at).toISOString().slice(0, 13), Number(p.price_eur_mwh)));

      let totalMwh = 0, energy = 0;
      (readings ?? []).forEach((r: any) => {
        const mwh = Number(r.actual_mwh ?? 0);
        totalMwh += mwh;
        const key = new Date(r.reading_at).toISOString().slice(0, 13);
        const price = client.contract_type === "fixed" ? Number(client.fixed_price_eur_mwh ?? 0) : (priceMap.get(key) ?? 0);
        energy += mwh * price;
      });
      const margin = totalMwh * Number(client.margin_eur_mwh);
      const total = energy + margin;
      const invoice_number = `INV-${format(new Date(), "yyyyMM")}-${Math.floor(Math.random()*9000+1000)}`;

      const { error } = await supabase.from("invoices").insert({
        user_id: user!.id, client_id, invoice_number,
        period_start, period_end, total_mwh: totalMwh,
        energy_amount_eur: energy, margin_amount_eur: margin, total_eur: total, status: "issued",
      });
      if (error) throw error;
      toast.success(`Invoice ${invoice_number} generated`);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const exportPdf = (inv: Invoice) => {
    const client = clients.find(c => c.id === inv.client_id);
    const doc = new jsPDF();
    doc.setFontSize(20); doc.text("VoltTrade ERP", 14, 20);
    doc.setFontSize(10); doc.setTextColor(120); doc.text("Electricity Trading & Supply", 14, 26);
    doc.setTextColor(0); doc.setFontSize(14); doc.text(`Invoice ${inv.invoice_number}`, 14, 40);
    doc.setFontSize(10);
    doc.text(`Client: ${client?.company_name ?? "—"}`, 14, 48);
    doc.text(`Period: ${inv.period_start} → ${inv.period_end}`, 14, 54);
    doc.text(`Status: ${inv.status.toUpperCase()}`, 14, 60);
    autoTable(doc, {
      startY: 70,
      head: [["Description", "Qty (MWh)", "Rate", "Amount (€)"]],
      body: [
        ["Energy supply", fmtNum(inv.total_mwh, 3), client?.contract_type === "fixed" ? `${fmtNum(Number(client.fixed_price_eur_mwh ?? 0))} €/MWh` : "Hourly HUPX", fmtNum(inv.energy_amount_eur)],
        ["Trading margin", fmtNum(inv.total_mwh, 3), `${fmtNum(Number(client?.margin_eur_mwh ?? 0))} €/MWh`, fmtNum(inv.margin_amount_eur)],
        [{ content: "Total", colSpan: 3, styles: { halign: "right", fontStyle: "bold" } }, { content: `${fmtNum(inv.total_eur)} €`, styles: { fontStyle: "bold" } }],
      ],
      styles: { fontSize: 10 }, headStyles: { fillColor: [21, 128, 95] },
    });
    doc.save(`${inv.invoice_number}.pdf`);
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
    <ErpLayout title="Billing & Invoicing" subtitle="Generate hourly-priced invoices and export reports"
      actions={<Button variant="secondary" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 mr-2" />Export Excel report</Button>}>
      <Card className="border-border/60">
        <CardHeader><CardTitle>Generate invoice</CardTitle><CardDescription>Calculates Σ(actual MWh × hourly price) + margin</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={e => { e.preventDefault(); generate(new FormData(e.currentTarget)); }} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-2 md:col-span-2">
              <Label>Client</Label>
              <Select name="client_id" required>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name} — {c.contract_type}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Period start</Label><Input name="period_start" type="date" required /></div>
            <div className="space-y-2"><Label>Period end</Label><Input name="period_end" type="date" required /></div>
            <Button type="submit" disabled={busy} className="md:col-span-4" style={{ background: "var(--gradient-primary)" }}>
              <Receipt className="h-4 w-4 mr-2" />{busy ? "Calculating…" : "Generate invoice"}
            </Button>
          </form>
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
              <TableHead>Status</TableHead><TableHead></TableHead>
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
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => exportPdf(inv)}><FileDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={async () => { await supabase.from("invoices").delete().eq("id", inv.id); load(); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">No invoices yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}