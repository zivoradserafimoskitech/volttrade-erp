import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportColumn = { key: string; label: string; format?: "eur" | "num" | "pct" | "text" };

const fmtCellEur = (v: any) => `€${Number(v ?? 0).toLocaleString("en-IE", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const fmtCellNum = (v: any) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtCellPct = (v: any) => `${Number(v ?? 0).toFixed(1)}%`;
const fmtCell = (v: any, f?: ExportColumn["format"]) =>
  f === "eur" ? fmtCellEur(v) : f === "num" ? fmtCellNum(v) : f === "pct" ? fmtCellPct(v) : String(v ?? "");

export function exportToExcel(filename: string, sheets: { name: string; columns: ExportColumn[]; rows: any[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const data = [s.columns.map(c => c.label), ...s.rows.map(r => s.columns.map(c => {
      const v = r[c.key];
      if (c.format === "eur" || c.format === "num" || c.format === "pct") return Number(v ?? 0);
      return v ?? "";
    }))];
    const ws = XLSX.utils.aoa_to_sheet(data);
    // Column widths
    ws["!cols"] = s.columns.map(c => ({ wch: Math.max(c.label.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportToPdf(opts: {
  title: string;
  subtitle?: string;
  filename: string;
  sections: { heading: string; columns: ExportColumn[]; rows: any[]; totals?: Record<string, any> }[];
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, w, 60, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("VoltTrade · ETRM/ERP", 40, 28);
  doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text(opts.title, 40, 46);
  doc.setFontSize(8); doc.setTextColor(180, 180, 200);
  doc.text(`Generated ${new Date().toLocaleString()}`, w - 40, 28, { align: "right" });
  if (opts.subtitle) doc.text(opts.subtitle, w - 40, 46, { align: "right" });

  let cursorY = 80;
  doc.setTextColor(0, 0, 0);

  for (const sec of opts.sections) {
    doc.setFontSize(12); doc.setFont("helvetica", "bold");
    doc.text(sec.heading, 40, cursorY);
    cursorY += 8;

    const head = [sec.columns.map(c => c.label)];
    const body = sec.rows.map(r => sec.columns.map(c => fmtCell(r[c.key], c.format)));
    const foot = sec.totals ? [sec.columns.map(c => sec.totals?.[c.key] != null ? fmtCell(sec.totals[c.key], c.format) : "")] : undefined;

    autoTable(doc, {
      head, body, foot,
      startY: cursorY + 4,
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 40, right: 40 },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 24;
    if (cursorY > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); cursorY = 60; }
  }

  // Footer page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120, 120, 130);
    doc.text(`Page ${i} of ${pages}`, w / 2, doc.internal.pageSize.getHeight() - 20, { align: "center" });
  }

  doc.save(`${opts.filename}.pdf`);
}