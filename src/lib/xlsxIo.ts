// Spreadsheet read/write, backed by ExcelJS.
//
// WHY THIS EXISTS
// ---------------
// The project used `xlsx` (SheetJS) 0.18.5, which carries two advisories with
// **no fix available on npm**: prototype pollution (GHSA-4r6h-8v6p-xvw6) and
// ReDoS (GHSA-5pgg-2g8v-p4x9). SheetJS publishes patched builds only from their
// own CDN, which means a registry the CI network policy does not allow. ExcelJS
// is maintained, on npm, and covers everything this codebase actually used:
// array-of-arrays and object sheets out, first-sheet rows in.
//
// Everything here is behind a dynamic import. ExcelJS is ~900 kB, and only
// three screens ever touch a spreadsheet — the main bundle should not carry it.
//
// NOTE on ExcelJS row indexing: `row.values` is 1-based and its element 0 is
// always undefined. readFirstSheetRows() normalises that away so callers get
// ordinary 0-based arrays, which is what the old sheet_to_json({header:1})
// returned.

export type SheetSpec = {
  name: string;
  /** Header row, then data rows. Values are written as-is (numbers stay numeric). */
  aoa: (string | number | null)[][];
  /** Optional per-column widths, in characters. */
  widths?: number[];
};

function downloadBlob(data: ArrayBuffer, filename: string) {
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download in
  // Safari before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Write one or more array-of-arrays sheets and trigger a download. */
export async function writeWorkbook(filename: string, sheets: SheetSpec[]): Promise<void> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  for (const s of sheets) {
    // Excel rejects sheet names over 31 chars and the characters below.
    const safeName = s.name.replace(/[*?:/\\[\]]/g, "-").slice(0, 31) || "Sheet";
    const ws = wb.addWorksheet(safeName);
    for (const row of s.aoa) ws.addRow(row);
    if (s.widths?.length) {
      s.widths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
      });
    }
    if (s.aoa.length) ws.getRow(1).font = { bold: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf as ArrayBuffer, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/** Write a single sheet from an array of flat objects; keys become the header. */
export async function writeJsonSheet(
  filename: string,
  sheetName: string,
  rows: Record<string, string | number | null | undefined>[],
): Promise<void> {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const aoa: (string | number | null)[][] = [
    headers,
    ...rows.map((r) => headers.map((h) => (r[h] ?? null) as string | number | null)),
  ];
  const widths = headers.map((h) => Math.max(h.length + 2, 14));
  await writeWorkbook(filename, [{ name: sheetName, aoa, widths }]);
}

/**
 * Read the first worksheet of an uploaded file as 0-based rows.
 * Replaces XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }).
 */
export async function readFirstSheetRows(file: File): Promise<unknown[][]> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const ws = wb.worksheets[0];
  if (!ws) return [];

  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[];
    // Drop the leading undefined that ExcelJS's 1-based indexing inserts.
    const cells = Array.isArray(values) ? values.slice(1) : [];
    out.push(
      cells.map((c) => {
        if (c === null || c === undefined) return null;
        // Formula cells arrive as { formula, result }; callers want the value.
        if (typeof c === "object" && c !== null && "result" in (c as object)) {
          return (c as { result: unknown }).result ?? null;
        }
        if (typeof c === "object" && c !== null && "text" in (c as object)) {
          return (c as { text: unknown }).text ?? null;
        }
        return c;
      }),
    );
  });
  return out;
}
