// Bulk manual import of DSO/EVN meter reads from CSV or Excel.
// Parses the file in the browser, previews the mapped rows, then posts them to
// the import-dso-reads edge function, which does the real validation. Rejected
// rows are reported back inline — nothing is inserted client-side.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { readFirstSheetRows } from "@/lib/xlsxIo";

type ParsedRow = { edu_code: string; reading_at?: string; month?: string; kwh: number; type: "MONTHLY" | "INTERVAL" };

const HEADER_ALIASES: Record<string, string> = {
  edu: "edu_code", edu_code: "edu_code", "edu code": "edu_code", mp: "edu_code",
  metering_point: "edu_code", "metering point": "edu_code", meter: "edu_code",
  reading_at: "reading_at", timestamp: "reading_at", datetime: "reading_at",
  time: "reading_at", date: "reading_at",
  month: "month", period: "month",
  kwh: "kwh", energy: "kwh", consumption: "kwh", value: "kwh", import_kwh: "kwh",
  type: "type", granularity: "type",
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";" || c === "\t") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

async function fileToMatrix(file: File): Promise<unknown[][]> {
  if (/\.(xlsx|xls)$/i.test(file.name)) return readFirstSheetRows(file);
  const text = await file.text();
  return text.split(/\r?\n/).filter(l => l.trim()).map(splitCsvLine);
}

function toIsoish(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return undefined; // handled as month
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function DsoImportDialog({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const reset = () => { setRows([]); setParseErrors([]); setFileName(""); setResult(null); };

  const onFile = async (file: File) => {
    reset();
    setFileName(file.name);
    try {
      const matrix = await fileToMatrix(file);
      if (matrix.length < 2) { setParseErrors(["File needs a header row plus at least one data row"]); return; }
      const header = (matrix[0] as unknown[]).map(h => HEADER_ALIASES[String(h ?? "").trim().toLowerCase()] ?? String(h ?? "").trim().toLowerCase());
      const idx = (k: string) => header.indexOf(k);
      const iEdu = idx("edu_code"), iKwh = idx("kwh"), iAt = idx("reading_at"), iMonth = idx("month"), iType = idx("type");
      if (iEdu < 0 || iKwh < 0) {
        setParseErrors([`Missing required columns. Found: ${header.join(", ") || "(none)"}. Need at least "edu_code" and "kwh".`]);
        return;
      }
      const errs: string[] = [];
      const parsed: ParsedRow[] = [];
      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r] as unknown[];
        const edu = String(row[iEdu] ?? "").trim();
        const kwh = Number(String(row[iKwh] ?? "").replace(",", "."));
        if (!edu) { errs.push(`Row ${r + 1}: missing EDU code`); continue; }
        if (!isFinite(kwh)) { errs.push(`Row ${r + 1}: kWh is not a number`); continue; }
        const monthRaw = iMonth >= 0 ? String(row[iMonth] ?? "").trim() : "";
        const at = iAt >= 0 ? toIsoish(row[iAt]) : undefined;
        const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : (iAt >= 0 && /^\d{4}-\d{2}$/.test(String(row[iAt] ?? "").trim()) ? String(row[iAt]).trim() : undefined);
        if (!at && !month) { errs.push(`Row ${r + 1}: no valid reading time or month (YYYY-MM)`); continue; }
        const type = (iType >= 0 && String(row[iType] ?? "").toUpperCase().startsWith("I")) ? "INTERVAL" : "MONTHLY";
        parsed.push({ edu_code: edu, reading_at: at, month, kwh, type });
      }
      setRows(parsed);
      setParseErrors(errs);
      if (!parsed.length) toast.error("No importable rows found");
    } catch (e: any) {
      setParseErrors([e?.message ?? "Could not read the file"]);
    }
  };

  const submit = async () => {
    if (!rows.length) return;
    setBusy(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("import-dso-reads", {
        body: { rows, allow_overwrite: allowOverwrite },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Import failed");
      setResult(data);
      toast.success(`Imported ${data.inserted} rows${data.overwritten ? `, ${data.overwritten} corrected` : ""}${data.rejected_count ? `, ${data.rejected_count} rejected` : ""}`);
      onImported?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline"><Upload className="h-4 w-4 mr-2" />Import file</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import DSO / EVN meter reads</DialogTitle>
          <DialogDescription>
            CSV or Excel with a header row. Required columns: <code>edu_code</code> and <code>kwh</code>.
            Add <code>reading_at</code> (date/time) or <code>month</code> (YYYY-MM), and optionally <code>type</code> (MONTHLY / INTERVAL).
            Validation happens server-side — implausible, duplicate or unknown rows are rejected, never inserted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dso-file">File</Label>
            <Input id="dso-file" type="file" accept=".csv,.txt,.xlsx,.xls"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            {fileName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" />{fileName} — {rows.length} row(s) ready
              </p>
            )}
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
              {parseErrors.slice(0, 20).map((e, i) => <div key={i}>{e}</div>)}
              {parseErrors.length > 20 && <div>…and {parseErrors.length - 20} more</div>}
            </div>
          )}

          {rows.length > 0 && (
            <div className="rounded-md border max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>EDU</TableHead><TableHead>Period</TableHead>
                  <TableHead className="text-right">kWh</TableHead><TableHead>Type</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{r.edu_code}</TableCell>
                      <TableCell className="text-xs">{r.reading_at ? new Date(r.reading_at).toLocaleString() : r.month}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.kwh}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{r.type}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 100 && <p className="text-xs text-muted-foreground p-2">Showing first 100 of {rows.length}.</p>}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox id="overwrite" checked={allowOverwrite} onCheckedChange={v => setAllowOverwrite(v === true)} />
            <Label htmlFor="overwrite" className="text-sm font-normal">
              Allow overwrite (DSO corrections to existing reads)
            </Label>
          </div>

          {result && (
            <div className="rounded-md border p-3 text-xs space-y-1">
              <div className="font-medium">
                Inserted {result.inserted} · Corrected {result.overwritten ?? 0} · Rejected {result.rejected_count ?? 0}
              </div>
              {(result.rejected ?? []).slice(0, 15).map((r: any, i: number) => (
                <div key={i} className="text-destructive">
                  {r.i != null ? `Row ${r.i + 2}: ` : ""}{r.reason}
                </div>
              ))}
              {(result.rejected?.length ?? 0) > 15 && <div>…and {result.rejected.length - 15} more</div>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={busy || !rows.length} style={{ background: "var(--gradient-primary)" }}>
            {busy ? "Importing…" : `Import ${rows.length || ""} row(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
