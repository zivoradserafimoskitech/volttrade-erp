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

  const exportPdf = async (inv: Invoice) => {
    const client = clients.find(c => c.id === inv.client_id);
    // Fetch meter detail for the period
    const { data: meters } = await supabase.from("metering_points").select("id, edu_code, address").eq("client_id", inv.client_id);
    const meterIds = (meters ?? []).map((m: any) => m.id);
    const startISO = new Date(inv.period_start).toISOString();
        const endISO = new Date(new Date(inv.period_end).getTime() + 24*3600*1000 - 1).toISOString();
    const { data: readings } = meterIds.length
      ? await supabase.from("consumption_readings").select("reading_at, actual_mwh, metering_point_id")
          .in("metering_point_id", meterIds).gte("reading_at", startISO).lte("reading_at", endISO)
      : { data: [] as any[] };

    const energy = Number(inv.energy_amount_eur ?? 0);
    const margin = Number(inv.margin_amount_eur ?? 0);
    const net = energy + margin;
    const vatRate = 0.18;
    const vat = net * vatRate;
    const gross = net + vat;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    // ── Top banner ──────────────────────────────────────────
    doc.setFillColor(15, 56, 102); doc.rect(0, 0, W, 70, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
    doc.text("VoltTrade", 40, 38);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text("Electricity Supply & Distribution", 40, 54);
    doc.setFontSize(8); doc.setTextColor(200, 220, 240);
    doc.text("VAT: HU 1234567890   |   IBAN: HU93 1177 3016 1111 1018 0000 0000", W - 40, 38, { align: "right" });
    doc.text("info@volttrade.example   |   www.volttrade.example", W - 40, 52, { align: "right" });

    // ── Customer block ──────────────────────────────────────
    let y = 100;
    doc.setTextColor(60); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("CUSTOMER", 40, y);
    doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(client?.company_name ?? "—", 40, y + 14);
    doc.setFontSize(9); doc.setTextColor(80);
    doc.text("Customer no.: " + (client?.id?.slice(0, 8).toUpperCase() ?? "—"), 40, y + 28);

    // Invoice meta block (right)
    const metaX = W - 260;
    doc.setFillColor(245, 247, 250); doc.rect(metaX, y - 12, 220, 70, "F");
    doc.setTextColor(15, 56, 102); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("INVOICE", metaX + 12, y + 4);
    doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`No.    ${inv.invoice_number}`, metaX + 12, y + 20);
    doc.text(`Issued ${format(new Date(), "dd.MM.yyyy")}`, metaX + 12, y + 34);
    doc.text(`Period ${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`, metaX + 12, y + 48);

    y += 60;

    // ── Charges summary ────────────────────────────────────
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(15, 56, 102);
    doc.text(`Invoice for period ${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`, 40, y);
    y += 8;

    autoTable(doc, {
      startY: y + 4,
      head: [["Description", "Amount (EUR)"]],
      body: [
        ["Energy supply", energy.toFixed(2)],
        ["Trading margin / access fee", margin.toFixed(2)],
        [`VAT ${(vatRate * 100).toFixed(0)}%`, vat.toFixed(2)],
      ],
      foot: [
        [{ content: "Amount payable by due date", styles: { fontStyle: "bold" } }, { content: gross.toFixed(2), styles: { fontStyle: "bold" } }],
        [{ content: "Outstanding balance", styles: { textColor: [120,120,120] } }, { content: "0.00", styles: { textColor: [120,120,120] } }],
        [{ content: "TOTAL TO PAY", styles: { fontStyle: "bold", fillColor: [15,56,102], textColor: 255 } },
         { content: gross.toFixed(2), styles: { fontStyle: "bold", fillColor: [15,56,102], textColor: 255 } }],
      ],
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [230, 236, 245], textColor: [15,56,102], fontStyle: "bold" },
      columnStyles: { 1: { halign: "right" } },
      margin: { left: 40, right: 40 },
    });
    y = (doc as any).lastAutoTable.finalY + 20;

    // ── Payment band ───────────────────────────────────────
    doc.setFillColor(245, 247, 250); doc.rect(40, y, W - 80, 60, "F");
    doc.setTextColor(15, 56, 102); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Payment instructions", 52, y + 18);
    doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text("• Pay via online banking or at any branch.", 52, y + 34);
    doc.text(`• Reference: ${inv.invoice_number}`, 52, y + 48);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(15, 56, 102);
    doc.text(`Due: ${format(new Date(new Date(inv.period_end).getTime() + 20*86400*1000), "dd.MM.yyyy")}`, W - 52, y + 18, { align: "right" });
    doc.setFontSize(14); doc.text(`${gross.toFixed(2)} EUR`, W - 52, y + 40, { align: "right" });
    y += 80;

    doc.setFontSize(7); doc.setTextColor(120);
    doc.text("VoltTrade Ltd. · Registered office: Budapest, Energy Plaza 1 · Status: " + inv.status.toUpperCase(), 40, H - 30);

    // ── Page 2: detail ─────────────────────────────────────
    doc.addPage();
    doc.setFillColor(15, 56, 102); doc.rect(0, 0, W, 40, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(`Invoice ${inv.invoice_number} — Detailed information`, 40, 26);

    let y2 = 70;
    doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Customer: ${client?.company_name ?? "—"}`, 40, y2);
    doc.text(`Contract type: ${client?.contract_type ?? "—"}`, 40, y2 + 14);
    doc.text(`Metering points: ${meterIds.length}`, 40, y2 + 28);
    y2 += 44;

    // Group readings by meter
    const byMeter: Record<string, any[]> = {};
    (readings ?? []).forEach((r: any) => { (byMeter[r.metering_point_id] ||= []).push(r); });

    (meters ?? []).forEach((m: any) => {
      const rs = byMeter[m.id] ?? [];
      const total = rs.reduce((s: number, r: any) => s + Number(r.actual_mwh ?? 0), 0);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(15, 56, 102);
      doc.text(`EDU ${m.edu_code}`, 40, y2);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(80);
      doc.text(m.address ?? "", 40, y2 + 12);
      y2 += 18;
      autoTable(doc, {
        startY: y2,
        head: [["Meter / tariff", "Period", "Quantity (MWh)", "Unit price €/MWh", "Amount EUR"]],
        body: [[
          m.edu_code, `${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`,
          total.toFixed(3),
          client?.contract_type === "fixed" ? Number(client.fixed_price_eur_mwh ?? 0).toFixed(2) : "Hourly (HUPX)",
          (total * (client?.contract_type === "fixed" ? Number(client.fixed_price_eur_mwh ?? 0) : (energy / Math.max(inv.total_mwh, 1e-9)))).toFixed(2),
        ]],
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [230, 236, 245], textColor: [15,56,102] },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
        margin: { left: 40, right: 40 },
      });
      y2 = (doc as any).lastAutoTable.finalY + 16;
      if (y2 > H - 80) { doc.addPage(); y2 = 60; }
    });

    // Footer page numbers
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Page ${i} of ${pages}`, W / 2, H - 20, { align: "center" });
    }

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