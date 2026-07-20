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
  contract_type: string;
  fixed_price_eur_mwh: number | null;
  margin_eur_mwh: number;
  country_code?: string | null;
};
export type InvoiceMeter = { id: string; edu_code: string; address?: string | null };
export type InvoiceReading = { reading_at: string; actual_mwh: number; metering_point_id: string; export_mwh?: number };

export type InvoiceLang = "en" | "mk" | "sq";
type TariffKey = "fixed" | "hourly" | "agile" | "prosumer";

const VAT = 0.18;

const THEMES: Record<string, { primary: [number, number, number]; tint: [number, number, number]; tariffKey: TariffKey }> = {
  fixed:    { primary: [15, 56, 102],  tint: [230, 236, 245], tariffKey: "fixed" },
  hourly:   { primary: [4, 96, 92],    tint: [219, 241, 239], tariffKey: "hourly" },
  agile:    { primary: [124, 45, 18],  tint: [253, 230, 213], tariffKey: "agile" },
  tou:      { primary: [124, 45, 18],  tint: [253, 230, 213], tariffKey: "agile" },
  prosumer: { primary: [21, 94, 39],   tint: [220, 240, 226], tariffKey: "prosumer" },
};

type Dict = {
  brand_tagline: string; vat_iban: string; contact: string;
  customer: string; customer_no: string;
  invoice_no: string; issued: string; period: string;
  invoice_for_period: string;
  description: string; amount: (cur: string) => string;
  total_to_pay: string;
  payment_instructions: string; pay_via: string; reference: string; due: string;
  page_x_of_y: (i: number, n: number) => string;
  tariff: string; status: string;
  detailed_info: (n: string) => string;
  metering_points: string;
  meter: string; quantity_mwh: string;
  unit_price: (cur: string) => string; amount_col: (cur: string) => string;
  import_mwh: string; export_mwh: string; net_mwh: string;
  peak_mwh: string; mid_mwh: string; offpeak_mwh: string; total_mwh: string;
  hourly_ref: string;
  energy_supply_fixed: (mwh: string, rate: string, cur: string) => string;
  trading_margin: (mwh: string, rate: string, cur: string) => string;
  energy_hourly: (mwh: string, wavg: string, cur: string) => string;
  supplier_margin_line: (mwh: string, rate: string, cur: string) => string;
  peak_band: (mwh: string) => string;
  mid_band: (mwh: string) => string;
  offpeak_band: (mwh: string) => string;
  supplier_margin_rate: (rate: string, cur: string) => string;
  energy_imported: (mwh: string) => string;
  energy_exported: (mwh: string, price: string, cur: string) => string;
  net_supplier_margin: string;
  vat_line: (pct: string) => string;
  tariff_labels: Record<TariffKey, string>;
  tariff_taglines: Record<TariffKey, string>;
  extra_agile: string;
  extra_prosumer: (price: string, cur: string) => string;
};

const DICTS: Record<InvoiceLang, Dict> = {
  en: {
    brand_tagline: "Energy supply & trading",
    vat_iban: "VAT: HU 1234567890   |   IBAN: HU93 1177 3016 1111 1018 0000 0000",
    contact: "info@volttrade.example   |   www.volttrade.example",
    customer: "CUSTOMER", customer_no: "Customer no.",
    invoice_no: "No.", issued: "Issued", period: "Period",
    invoice_for_period: "Invoice for period",
    description: "Description", amount: (c) => `Amount (${c})`,
    total_to_pay: "TOTAL TO PAY (incl. VAT)",
    payment_instructions: "Payment instructions",
    pay_via: "• Pay via online banking or at any branch.",
    reference: "Reference", due: "Due",
    page_x_of_y: (i, n) => `Page ${i} of ${n}`,
    tariff: "Tariff", status: "Status",
    detailed_info: (n) => `Invoice ${n} — Detailed information`,
    metering_points: "Metering points",
    meter: "Meter", quantity_mwh: "Quantity (MWh)",
    unit_price: (c) => `Unit price ${c}/MWh`,
    amount_col: (c) => `Amount ${c}`,
    import_mwh: "Import MWh", export_mwh: "Export MWh", net_mwh: "Net MWh",
    peak_mwh: "Peak MWh", mid_mwh: "Mid MWh", offpeak_mwh: "Off-peak MWh", total_mwh: "Total MWh",
    hourly_ref: "Hourly (HUPX)",
    energy_supply_fixed: (m, r, c) => `Energy supply — ${m} MWh × ${r} ${c}/MWh (fixed)`,
    trading_margin: (m, r, c) => `Trading margin — ${m} MWh × ${r} ${c}/MWh`,
    energy_hourly: (m, w, c) => `Energy — ${m} MWh × HUPX hourly (wavg ${w} ${c}/MWh)`,
    supplier_margin_line: (m, r, c) => `Supplier margin — ${m} MWh × ${r} ${c}/MWh`,
    peak_band: (m) => `Peak band (17:00–21:00) — ${m} MWh`,
    mid_band: (m) => `Mid band (07:00–17:00) — ${m} MWh`,
    offpeak_band: (m) => `Off-peak (21:00–07:00) — ${m} MWh`,
    supplier_margin_rate: (r, c) => `Supplier margin — ${r} ${c}/MWh`,
    energy_imported: (m) => `Energy imported — ${m} MWh`,
    energy_exported: (m, p, c) => `Energy exported (credit) — ${m} MWh × ${p} ${c}/MWh`,
    net_supplier_margin: "Net supplier margin",
    vat_line: (p) => `VAT ${p}%`,
    tariff_labels: { fixed: "FIXED-PRICE INVOICE", hourly: "SPOT-INDEXED INVOICE", agile: "AGILE / TOU INVOICE", prosumer: "PROSUMER NET-METERING" },
    tariff_taglines: { fixed: "Flat €/MWh tariff", hourly: "Hourly day-ahead pricing", agile: "Time-of-use bands", prosumer: "Import / export reconciliation" },
    extra_agile: "ToU bands applied per agile-tariff schedule (HUPX-linked, capped).",
    extra_prosumer: (p, c) => `Export volume credited at ${p} ${c}/MWh (90% of import reference).`,
  },
  mk: {
    brand_tagline: "Snabduvanje i trguvanje so energija",
    vat_iban: "DDV: MK 1234567890   |   IBAN: MK07 2000 0000 0000 0000",
    contact: "info@volttrade.example   |   www.volttrade.example",
    customer: "KORISNIK", customer_no: "Broj na korisnik",
    invoice_no: "Br.", issued: "Izdadena", period: "Period",
    invoice_for_period: "Faktura za period",
    description: "Opis", amount: (c) => `Iznos (${c})`,
    total_to_pay: "VKUPNO ZA PLAKJANJE (so DDV)",
    payment_instructions: "Upatstva za plakjanje",
    pay_via: "• Platete preku elektronsko bankarstvo ili vo bilo koja filijala.",
    reference: "Referenca", due: "Rok",
    page_x_of_y: (i, n) => `Strana ${i} od ${n}`,
    tariff: "Tarifa", status: "Status",
    detailed_info: (n) => `Faktura ${n} — Detalni informacii`,
    metering_points: "Merni mesta",
    meter: "Brojač", quantity_mwh: "Količina (MWh)",
    unit_price: (c) => `Edinečna cena ${c}/MWh`,
    amount_col: (c) => `Iznos ${c}`,
    import_mwh: "Uvoz MWh", export_mwh: "Izvoz MWh", net_mwh: "Neto MWh",
    peak_mwh: "Vrv MWh", mid_mwh: "Sreden MWh", offpeak_mwh: "Vongraf MWh", total_mwh: "Vkupno MWh",
    hourly_ref: "Časovno (HUPX)",
    energy_supply_fixed: (m, r, c) => `Snabduvanje so energija — ${m} MWh × ${r} ${c}/MWh (fiksno)`,
    trading_margin: (m, r, c) => `Trgovska marža — ${m} MWh × ${r} ${c}/MWh`,
    energy_hourly: (m, w, c) => `Energija — ${m} MWh × HUPX časovno (prosek ${w} ${c}/MWh)`,
    supplier_margin_line: (m, r, c) => `Marža na snabduvač — ${m} MWh × ${r} ${c}/MWh`,
    peak_band: (m) => `Vrven pojas (17:00–21:00) — ${m} MWh`,
    mid_band: (m) => `Sreden pojas (07:00–17:00) — ${m} MWh`,
    offpeak_band: (m) => `Vongraf (21:00–07:00) — ${m} MWh`,
    supplier_margin_rate: (r, c) => `Marža na snabduvač — ${r} ${c}/MWh`,
    energy_imported: (m) => `Uvezena energija — ${m} MWh`,
    energy_exported: (m, p, c) => `Izvezena energija (kredit) — ${m} MWh × ${p} ${c}/MWh`,
    net_supplier_margin: "Neto marža na snabduvač",
    vat_line: (p) => `DDV ${p}%`,
    tariff_labels: { fixed: "FAKTURA SO FIKSNA CENA", hourly: "FAKTURA INDEKSIRANA NA SPOT", agile: "FAKTURA AGILE / TOU", prosumer: "PROSUMER NETO-MERENJE" },
    tariff_taglines: { fixed: "Fiksna €/MWh tarifa", hourly: "Časovni day-ahead ceni", agile: "Pojasi spored vreme na koristenje", prosumer: "Reconciliacija uvoz / izvoz" },
    extra_agile: "ToU pojasite se primeneti spored agile-tarifniot raspored (HUPX-povrzan, ograničen).",
    extra_prosumer: (p, c) => `Izvozniot volumen se kreditira po ${p} ${c}/MWh (90% od uvoznata referenca).`,
  },
  sq: {
    brand_tagline: "Furnizim dhe tregtim i energjisë",
    vat_iban: "TVSH: 1234567890   |   IBAN: XK05 1212 0000 0000 0000",
    contact: "info@volttrade.example   |   www.volttrade.example",
    customer: "KLIENTI", customer_no: "Nr. i klientit",
    invoice_no: "Nr.", issued: "Lëshuar", period: "Periudha",
    invoice_for_period: "Faturë për periudhën",
    description: "Përshkrimi", amount: (c) => `Shuma (${c})`,
    total_to_pay: "TOTALI PËR PAGESË (përfshirë TVSH)",
    payment_instructions: "Udhëzime për pagesë",
    pay_via: "• Paguani përmes bankës online ose në çdo degë.",
    reference: "Referenca", due: "Afati",
    page_x_of_y: (i, n) => `Faqja ${i} nga ${n}`,
    tariff: "Tarifa", status: "Statusi",
    detailed_info: (n) => `Fatura ${n} — Informacion i detajuar`,
    metering_points: "Pikat e matjes",
    meter: "Matësi", quantity_mwh: "Sasia (MWh)",
    unit_price: (c) => `Çmimi për njësi ${c}/MWh`,
    amount_col: (c) => `Shuma ${c}`,
    import_mwh: "Import MWh", export_mwh: "Eksport MWh", net_mwh: "Neto MWh",
    peak_mwh: "Pik MWh", mid_mwh: "Mes MWh", offpeak_mwh: "Jashtë-piku MWh", total_mwh: "Totali MWh",
    hourly_ref: "Orare (HUPX)",
    energy_supply_fixed: (m, r, c) => `Furnizim me energji — ${m} MWh × ${r} ${c}/MWh (fikse)`,
    trading_margin: (m, r, c) => `Marzhi tregtar — ${m} MWh × ${r} ${c}/MWh`,
    energy_hourly: (m, w, c) => `Energji — ${m} MWh × HUPX orare (mesatare ${w} ${c}/MWh)`,
    supplier_margin_line: (m, r, c) => `Marzhi i furnizuesit — ${m} MWh × ${r} ${c}/MWh`,
    peak_band: (m) => `Brezi i pikut (17:00–21:00) — ${m} MWh`,
    mid_band: (m) => `Brezi i mesëm (07:00–17:00) — ${m} MWh`,
    offpeak_band: (m) => `Jashtë-piku (21:00–07:00) — ${m} MWh`,
    supplier_margin_rate: (r, c) => `Marzhi i furnizuesit — ${r} ${c}/MWh`,
    energy_imported: (m) => `Energjia e importuar — ${m} MWh`,
    energy_exported: (m, p, c) => `Energjia e eksportuar (kredi) — ${m} MWh × ${p} ${c}/MWh`,
    net_supplier_margin: "Marzhi neto i furnizuesit",
    vat_line: (p) => `TVSH ${p}%`,
    tariff_labels: { fixed: "FATURË ME ÇMIM FIKS", hourly: "FATURË E LIDHUR ME SPOT", agile: "FATURË AGILE / TOU", prosumer: "PROSUMER NET-METERING" },
    tariff_taglines: { fixed: "Tarifë fikse €/MWh", hourly: "Çmime ditore orare", agile: "Breza sipas kohës së përdorimit", prosumer: "Rakordim import / eksport" },
    extra_agile: "Brezat ToU zbatohen sipas orarit agile (lidhur me HUPX, me kufi).",
    extra_prosumer: (p, c) => `Vëllimi i eksportit kreditohet me ${p} ${c}/MWh (90% e referencës së importit).`,
  },
};

export function detectInvoiceLang(country?: string | null): InvoiceLang {
  if (country === "MK") return "mk";
  if (country === "AL" || country === "XK") return "sq";
  return "en";
}

function header(doc: jsPDF, theme: typeof THEMES[string], t: Dict) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...theme.primary); doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  doc.text("VoltTrade", 40, 38);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(t.tariff_taglines[theme.tariffKey], 40, 54);
  doc.setFontSize(8); doc.setTextColor(220, 230, 245);
  doc.text(t.vat_iban, W - 40, 38, { align: "right" });
  doc.text(t.contact, W - 40, 52, { align: "right" });
}

function customerBlock(doc: jsPDF, theme: typeof THEMES[string], client: InvoiceClient, inv: InvoiceData, t: Dict) {
  const W = doc.internal.pageSize.getWidth();
  const y = 100;
  doc.setTextColor(60); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text(t.customer, 40, y);
  doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(client.company_name, 40, y + 14);
  doc.setFontSize(9); doc.setTextColor(80);
  doc.text(`${t.customer_no}: ${client.id.slice(0, 8).toUpperCase()}`, 40, y + 28);
  const metaX = W - 260;
  doc.setFillColor(...theme.tint); doc.rect(metaX, y - 12, 220, 70, "F");
  doc.setTextColor(...theme.primary); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(t.tariff_labels[theme.tariffKey], metaX + 12, y + 4);
  doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`${t.invoice_no}    ${inv.invoice_number}`, metaX + 12, y + 20);
  doc.text(`${t.issued} ${format(new Date(), "dd.MM.yyyy")}`, metaX + 12, y + 34);
  doc.text(`${t.period} ${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`, metaX + 12, y + 48);
  return y + 60;
}

function summaryTable(doc: jsPDF, y: number, theme: typeof THEMES[string], rows: [string, number][], gross: number, t: Dict, currency: string) {
  autoTable(doc, {
    startY: y + 8,
    head: [[t.description, t.amount(currency)]],
    body: rows.map(([k, v]) => [k, v.toFixed(2)]),
    foot: [[
      { content: t.total_to_pay, styles: { fontStyle: "bold", fillColor: theme.primary, textColor: 255 } },
      { content: gross.toFixed(2), styles: { fontStyle: "bold", fillColor: theme.primary, textColor: 255 } },
    ]],
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: theme.tint, textColor: theme.primary, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: 40, right: 40 },
  });
  return (doc as any).lastAutoTable.finalY + 20;
}

function paymentBand(doc: jsPDF, y: number, theme: typeof THEMES[string], inv: InvoiceData, gross: number, t: Dict, currency: string) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...theme.tint); doc.rect(40, y, W - 80, 60, "F");
  doc.setTextColor(...theme.primary); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(t.payment_instructions, 52, y + 18);
  doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(t.pay_via, 52, y + 34);
  doc.text(`• ${t.reference}: ${inv.invoice_number}`, 52, y + 48);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...theme.primary);
  doc.text(`${t.due}: ${format(new Date(new Date(inv.period_end).getTime() + 20 * 86400 * 1000), "dd.MM.yyyy")}`, W - 52, y + 18, { align: "right" });
  doc.setFontSize(14); doc.text(`${gross.toFixed(2)} ${currency}`, W - 52, y + 40, { align: "right" });
  return y + 80;
}

function footerPages(doc: jsPDF, t: Dict) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(t.page_x_of_y(i, pages), W / 2, H - 20, { align: "center" });
  }
}

function chargesFixed(c: InvoiceClient, inv: InvoiceData, t: Dict, cur: string): [string, number][] {
  const rate = Number(c.fixed_price_eur_mwh ?? 0);
  return [
    [t.energy_supply_fixed(inv.total_mwh.toFixed(3), rate.toFixed(2), cur), inv.energy_amount_eur],
    [t.trading_margin(inv.total_mwh.toFixed(3), Number(c.margin_eur_mwh).toFixed(2), cur), inv.margin_amount_eur],
  ];
}
function chargesHourly(c: InvoiceClient, inv: InvoiceData, t: Dict, cur: string): [string, number][] {
  const wavg = inv.total_mwh > 0 ? inv.energy_amount_eur / inv.total_mwh : 0;
  return [
    [t.energy_hourly(inv.total_mwh.toFixed(3), wavg.toFixed(2), cur), inv.energy_amount_eur],
    [t.supplier_margin_line(inv.total_mwh.toFixed(3), Number(c.margin_eur_mwh).toFixed(2), cur), inv.margin_amount_eur],
  ];
}
function chargesAgile(c: InvoiceClient, inv: InvoiceData, t: Dict, cur: string): [string, number][] {
  const peak = inv.energy_amount_eur * 0.35, mid = inv.energy_amount_eur * 0.45, off = inv.energy_amount_eur * 0.20;
  return [
    [t.peak_band((inv.total_mwh * 0.35).toFixed(3)), peak],
    [t.mid_band((inv.total_mwh * 0.45).toFixed(3)), mid],
    [t.offpeak_band((inv.total_mwh * 0.20).toFixed(3)), off],
    [t.supplier_margin_rate(Number(c.margin_eur_mwh).toFixed(2), cur), inv.margin_amount_eur],
  ];
}
function chargesProsumer(_c: InvoiceClient, inv: InvoiceData, exportMwh: number, exportPrice: number, t: Dict, cur: string): [string, number][] {
  const credit = exportMwh * exportPrice;
  return [
    [t.energy_imported(inv.total_mwh.toFixed(3)), inv.energy_amount_eur],
    [t.energy_exported(exportMwh.toFixed(3), exportPrice.toFixed(2), cur), -credit],
    [t.net_supplier_margin, inv.margin_amount_eur],
  ];
}

export function renderInvoicePdf(args: {
  inv: InvoiceData;
  client: InvoiceClient;
  meters: InvoiceMeter[];
  readings: InvoiceReading[];
  lang?: InvoiceLang;
  currency?: string;
}) {
  const { inv, client, meters, readings } = args;
  const lang: InvoiceLang = args.lang ?? detectInvoiceLang(client.country_code);
  const t = DICTS[lang];
  const currency = args.currency ?? "EUR";
  const tariff = (client.contract_type || "fixed").toLowerCase();
  const theme = THEMES[tariff] ?? THEMES.fixed;

  let charges: [string, number][];
  let extraDetail: string[] = [];
  const stored = Array.isArray((inv as any).components) ? ((inv as any).components as any[]) : [];
  let storedVatLine: [string, number] | null = null;
  if (stored.length > 0) {
    // Invoice was generated by the billing engine — render exactly what was billed.
    charges = stored
      .filter(c => c.type !== 'vat' && c.type !== 'meta' && Number(c.amount_eur ?? 0) !== 0)
      .map(c => [
        c.mwh != null ? `${c.label} — ${Number(c.mwh).toFixed(3)} MWh × ${Number(c.price_eur_mwh ?? 0).toFixed(4)} ${currency}/MWh` : String(c.label),
        Number(c.amount_eur ?? 0),
      ] as [string, number]);
    extraDetail = stored.filter(c => c.type === 'meta').map(c => String(c.label));
    const storedVat = stored.find(c => c.type === 'vat');
    if (storedVat) storedVatLine = [String(storedVat.label), Number(storedVat.amount_eur ?? 0)];
  }
  else if (tariff === "hourly" || tariff === "spot") charges = chargesHourly(client, inv, t, currency);
  else if (tariff === "agile" || tariff === "tou") {
    charges = chargesAgile(client, inv, t, currency);
    extraDetail = [t.extra_agile];
  } else if (tariff === "prosumer") {
    const exportMwh = readings.reduce((s, r) => s + Number(r.export_mwh ?? 0), 0);
    const exportPrice = client.fixed_price_eur_mwh ? Number(client.fixed_price_eur_mwh) * 0.9 : 70;
    charges = chargesProsumer(client, inv, exportMwh, exportPrice, t, currency);
    extraDetail = [t.extra_prosumer(exportPrice.toFixed(2), currency)];
  } else charges = chargesFixed(client, inv, t, currency);

  const net = charges.reduce((s, [, v]) => s + v, 0);
  const vat = storedVatLine ? storedVatLine[1] : net * VAT;
  const gross = net + vat;
  charges = [...charges, storedVatLine ?? [t.vat_line((VAT * 100).toFixed(0)), vat]];

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  header(doc, theme, t);
  let y = customerBlock(doc, theme, client, inv, t);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...theme.primary);
  doc.text(`${t.invoice_for_period} ${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`, 40, y);
  y = summaryTable(doc, y, theme, charges, gross, t, currency);
  y = paymentBand(doc, y, theme, inv, gross, t, currency);

  doc.setFontSize(7); doc.setTextColor(120);
  doc.text(`VoltTrade Ltd. · ${t.tariff}: ${tariff.toUpperCase()} · ${t.status}: ${inv.status.toUpperCase()}`, 40, H - 30);

  doc.addPage();
  doc.setFillColor(...theme.primary); doc.rect(0, 0, W, 40, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(t.detailed_info(inv.invoice_number), 40, 26);

  let y2 = 70;
  doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`${t.customer}: ${client.company_name}`, 40, y2);
  doc.text(`${t.tariff}: ${tariff.toUpperCase()}`, 40, y2 + 14);
  doc.text(`${t.metering_points}: ${meters.length}`, 40, y2 + 28);
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
      ? [[t.meter, t.period, t.import_mwh, t.export_mwh, t.net_mwh]]
      : tariff === "agile" || tariff === "tou"
        ? [[t.meter, t.period, t.peak_mwh, t.mid_mwh, t.offpeak_mwh, t.total_mwh]]
        : [[t.meter, t.period, t.quantity_mwh, t.unit_price(currency), t.amount_col(currency)]];

    const period = `${format(new Date(inv.period_start), "dd.MM.yyyy")} – ${format(new Date(inv.period_end), "dd.MM.yyyy")}`;
    const body = tariff === "prosumer"
      ? [[m.edu_code, period, total.toFixed(3), exp.toFixed(3), (total - exp).toFixed(3)]]
      : tariff === "agile" || tariff === "tou"
        ? [[m.edu_code, period, (total * 0.35).toFixed(3), (total * 0.45).toFixed(3), (total * 0.20).toFixed(3), total.toFixed(3)]]
        : [[
            m.edu_code, period, total.toFixed(3),
            tariff === "fixed" ? Number(client.fixed_price_eur_mwh ?? 0).toFixed(2) : t.hourly_ref,
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

  footerPages(doc, t);
  doc.save(`${inv.invoice_number}.pdf`);
}
