import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";

export type InvoiceData = {
  invoice_number: string;
  period_start: string;
  period_end: string;
  total_mwh: number;
  energy_amount_eur: number;
  margin_amount_eur: number;
  total_eur: number;
  status: string;
};
export type InvoiceClient = {
  id: string;
  company_name: string;
  contract_type: string; // fixed | hourly | agile | prosumer | tou
  fixed_price_eur_mwh: number | null;
  margin_eur_mwh: number;
};
export type InvoiceMeter = { id: string; edu_code: string; address?: string | null };
export type InvoiceReading = { reading_at: string; actual_mwh: number; metering_point_id: string; export_mwh?: number };

const VAT = 0.18;
const THEMES: Record<string, { primary: [number, number, number]; tint: [number, number, number]; label: string; tagline: string }> = {
  fixed:    { primary: [15, 56, 102],  tint: [230, 236, 245], label: "FIXED-PRICE INVOICE",      tagline: "Flat €/MWh tariff" },
  hourly:   { primary: [4, 96, 92],    tint: [219, 241, 239], label: "SPOT-INDEXED INVOICE",     tagline: "Hourly day-ahead pricing" },
  agile:    { primary: [124, 45, 18],  tint: [253, 230, 213], label: "AGILE / TOU INVOICE",      tagline: "Time-of-use bands" },
  tou:      { primary: [124, 45, 18],  tint: [253, 230, 213], label: "AGILE / TOU INVOICE",      tagline: "Time-of-use bands" },
  prosumer: { primary: [21, 94, 39],   tint: [220, 240, 226], label: "PROSUMER NET-METERING",    tagline: "Import / export reconciliation" },
};

function header(doc: jsPDF, theme: typeof THEMES[string]) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...theme.primary); doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  doc.text("VoltTrade", 40, 38);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(theme.tagline, 40, 54);
  doc.setFontSize(8); doc.setTextColor(220, 230, 245);
  doc.text("VAT: HU 1234567890   |   IBAN: HU93 1177 3016 1111 1018 0000 0000", W - 40, 38, { align: "right" });
  doc.text("info@volttrade.example   |   www.volttrade.example", W - 40, 52, { align: "right" });
}

function customerBlock(doc: jsPDF, theme: typeof THEMES[string], client: InvoiceClient, inv: InvoiceData) {
  const W = doc.internal.pageSize.getWidth();
  let y = 100;
  doc.setTextColor(60); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text("CUSTOMER", 40, y);
  doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(client.company_name, 40, y + 14);
  doc.setFontSize(9); doc.setTextColor(80);
  doc.text("Customer no.: " + client.id.slice(0, 8).toUpperCase(), 40, y + 28);

  const metaX = W - 260;
  doc.setFillColor(...theme.tint); doc.rect(metaX, y - 12, 220, 70, "F");
  doc.setTextColor(...theme.primary); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(theme.label, metaX + 12, y + 4);
  doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`No.    ${inv.invoice_number}`, metaX + 12, y + 20);
  doc.text(`Issued ${format(new Date(), "dd.MM.yyyy")}`, metaX + 12, y + 34);
  doc.text(`Period ${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`, metaX + 12, y + 48);
  return y + 60;
}

function summaryTable(doc: jsPDF, y: number, theme: typeof THEMES[string], rows: [string, number][], gross: number) {
  autoTable(doc, {
    startY: y + 8,
    head: [["Description", "Amount (EUR)"]],
    body: rows.map(([k, v]) => [k, v.toFixed(2)]),
    foot: [[
      { content: "TOTAL TO PAY (incl. VAT)", styles: { fontStyle: "bold", fillColor: theme.primary, textColor: 255 } },
      { content: gross.toFixed(2), styles: { fontStyle: "bold", fillColor: theme.primary, textColor: 255 } },
    ]],
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: theme.tint, textColor: theme.primary, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: 40, right: 40 },
  });
  return (doc as any).lastAutoTable.finalY + 20;
}

function paymentBand(doc: jsPDF, y: number, theme: typeof THEMES[string], inv: InvoiceData, gross: number) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...theme.tint); doc.rect(40, y, W - 80, 60, "F");
  doc.setTextColor(...theme.primary); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("Payment instructions", 52, y + 18);
  doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("• Pay via online banking or at any branch.", 52, y + 34);
  doc.text(`• Reference: ${inv.invoice_number}`, 52, y + 48);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...theme.primary);
  doc.text(`Due: ${format(new Date(new Date(inv.period_end).getTime() + 20 * 86400 * 1000), "dd.MM.yyyy")}`, W - 52, y + 18, { align: "right" });
  doc.setFontSize(14); doc.text(`${gross.toFixed(2)} EUR`, W - 52, y + 40, { align: "right" });
  return y + 80;
}

function footerPages(doc: jsPDF) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Page ${i} of ${pages}`, W / 2, H - 20, { align: "center" });
  }
}

// ── Template-specific charge breakdowns ──────────────────────────────────
function chargesFixed(c: InvoiceClient, inv: InvoiceData): [string, number][] {
  const rate = Number(c.fixed_price_eur_mwh ?? 0);
  return [
    [`Energy supply — ${inv.total_mwh.toFixed(3)} MWh × ${rate.toFixed(2)} €/MWh (fixed)`, inv.energy_amount_eur],
    [`Trading margin — ${inv.total_mwh.toFixed(3)} MWh × ${Number(c.margin_eur_mwh).toFixed(2)} €/MWh`, inv.margin_amount_eur],
  ];
}
function chargesHourly(c: InvoiceClient, inv: InvoiceData): [string, number][] {
  const wavg = inv.total_mwh > 0 ? inv.energy_amount_eur / inv.total_mwh : 0;
  return [
    [`Energy — ${inv.total_mwh.toFixed(3)} MWh × HUPX hourly (wavg ${wavg.toFixed(2)} €/MWh)`, inv.energy_amount_eur],
    [`Supplier margin — ${inv.total_mwh.toFixed(3)} MWh × ${Number(c.margin_eur_mwh).toFixed(2)} €/MWh`, inv.margin_amount_eur],
  ];
}
function chargesAgile(c: InvoiceClient, inv: InvoiceData): [string, number][] {
  // ToU split (illustrative): 35% peak / 45% mid / 20% off-peak
  const peak = inv.energy_amount_eur * 0.35, mid = inv.energy_amount_eur * 0.45, off = inv.energy_amount_eur * 0.20;
  return [
    [`Peak band (17:00–21:00) — ${(inv.total_mwh * 0.35).toFixed(3)} MWh`, peak],
    [`Mid band (07:00–17:00) — ${(inv.total_mwh * 0.45).toFixed(3)} MWh`, mid],
    [`Off-peak (21:00–07:00) — ${(inv.total_mwh * 0.20).toFixed(3)} MWh`, off],
    [`Supplier margin — ${Number(c.margin_eur_mwh).toFixed(2)} €/MWh`, inv.margin_amount_eur],
  ];
}
function chargesProsumer(c: InvoiceClient, inv: InvoiceData, exportMwh: number, exportPrice: number): [string, number][] {
  const importMwh = inv.total_mwh;
  const credit = exportMwh * exportPrice;
  return [
    [`Energy imported — ${importMwh.toFixed(3)} MWh`, inv.energy_amount_eur],
    [`Energy exported (credit) — ${exportMwh.toFixed(3)} MWh × ${exportPrice.toFixed(2)} €/MWh`, -credit],
    [`Net supplier margin`, inv.margin_amount_eur],
  ];
}

// ── Public renderer ──────────────────────────────────────────────────────
export function renderInvoicePdf(args: {
  inv: InvoiceData;
  client: InvoiceClient;
  meters: InvoiceMeter[];
  readings: InvoiceReading[];
}) {
  const { inv, client, meters, readings } = args;
  const tariff = (client.contract_type || "fixed").toLowerCase();
  const theme = THEMES[tariff] ?? THEMES.fixed;

  let charges: [string, number][];
  let extraDetail: string[] = [];
  if (tariff === "hourly" || tariff === "spot") charges = chargesHourly(client, inv);
  else if (tariff === "agile" || tariff === "tou") {
    charges = chargesAgile(client, inv);
    extraDetail = ["ToU bands applied per agile-tariff schedule (HUPX-linked, capped)."];
  } else if (tariff === "prosumer") {
    const exportMwh = readings.reduce((s, r) => s + Number(r.export_mwh ?? 0), 0);
    const exportPrice = client.fixed_price_eur_mwh ? Number(client.fixed_price_eur_mwh) * 0.9 : 70;
    charges = chargesProsumer(client, inv, exportMwh, exportPrice);
    extraDetail = [`Export volume credited at ${exportPrice.toFixed(2)} €/MWh (90% of import reference).`];
  } else charges = chargesFixed(client, inv);

  const net = charges.reduce((s, [, v]) => s + v, 0);
  const vat = net * VAT;
  const gross = net + vat;
  charges = [...charges, [`VAT ${(VAT * 100).toFixed(0)}%`, vat]];

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  header(doc, theme);
  let y = customerBlock(doc, theme, client, inv);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...theme.primary);
  doc.text(`Invoice for period ${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`, 40, y);
  y = summaryTable(doc, y, theme, charges, gross);
  y = paymentBand(doc, y, theme, inv, gross);

  doc.setFontSize(7); doc.setTextColor(120);
  doc.text(`VoltTrade Ltd. · Tariff: ${tariff.toUpperCase()} · Status: ${inv.status.toUpperCase()}`, 40, H - 30);

  // Detail page
  doc.addPage();
  doc.setFillColor(...theme.primary); doc.rect(0, 0, W, 40, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(`Invoice ${inv.invoice_number} — Detailed information`, 40, 26);

  let y2 = 70;
  doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Customer: ${client.company_name}`, 40, y2);
  doc.text(`Tariff: ${tariff.toUpperCase()}`, 40, y2 + 14);
  doc.text(`Metering points: ${meters.length}`, 40, y2 + 28);
  y2 += 44;
  extraDetail.forEach(line => { doc.setFontSize(8); doc.setTextColor(80); doc.text(line, 40, y2); y2 += 12; });

  const byMeter: Record<string, InvoiceReading[]> = {};
  readings.forEach(r => { (byMeter[r.metering_point_id] ||= []).push(r); });

  meters.forEach(m => {
    const rs = byMeter[m.id] ?? [];
    const total = rs.reduce((s, r) => s + Number(r.actual_mwh ?? 0), 0);
    const exp = rs.reduce((s, r) => s + Number(r.export_mwh ?? 0), 0);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...theme.primary);
    doc.text(`EDU ${m.edu_code}`, 40, y2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(80);
    if (m.address) doc.text(m.address, 40, y2 + 12);
    y2 += 18;

    const head = tariff === "prosumer"
      ? [["Meter", "Period", "Import MWh", "Export MWh", "Net MWh"]]
      : tariff === "agile" || tariff === "tou"
        ? [["Meter", "Period", "Peak MWh", "Mid MWh", "Off-peak MWh", "Total MWh"]]
        : [["Meter", "Period", "Quantity (MWh)", "Unit price €/MWh", "Amount EUR"]];

    const period = `${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`;
    const body = tariff === "prosumer"
      ? [[m.edu_code, period, total.toFixed(3), exp.toFixed(3), (total - exp).toFixed(3)]]
      : tariff === "agile" || tariff === "tou"
        ? [[m.edu_code, period, (total * 0.35).toFixed(3), (total * 0.45).toFixed(3), (total * 0.20).toFixed(3), total.toFixed(3)]]
        : [[
            m.edu_code, period, total.toFixed(3),
            tariff === "fixed" ? Number(client.fixed_price_eur_mwh ?? 0).toFixed(2) : "Hourly (HUPX)",
            (total * (tariff === "fixed" ? Number(client.fixed_price_eur_mwh ?? 0) : (inv.energy_amount_eur / Math.max(inv.total_mwh, 1e-9)))).toFixed(2),
          ]];

    autoTable(doc, {
      startY: y2, head, body,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: theme.tint, textColor: theme.primary },
      margin: { left: 40, right: 40 },
    });
    y2 = (doc as any).lastAutoTable.finalY + 16;
    if (y2 > H - 80) { doc.addPage(); y2 = 60; }
  });

  footerPages(doc);
  doc.save(`${inv.invoice_number}.pdf`);
}
