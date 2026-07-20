import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Plus, Check, X, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";

const STATUS_VARIANT: Record<string,string> = { pending: 'secondary', validated: 'default', rejected: 'destructive', corrected: 'outline' };

export default function MeterReadings() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [mps, setMps] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [filterMp, setFilterMp] = useState<string>("all");

  const load = async () => {
    const { data: r } = await supabase.from("meter_readings").select("*").order("reading_at", { ascending: false }).limit(500);
    const { data: m } = await supabase.from("metering_points").select("id,edu_code");
    setRows(r ?? []); setMps(m ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const add = async (form: FormData) => {
    const mpId = String(form.get("metering_point_id"));
    const imp = Number(form.get("import_kwh") || 0);
    const exp = Number(form.get("export_kwh") || 0);
    const at = new Date(String(form.get("reading_at")));
    if (Number.isNaN(at.getTime())) return toast.error("Invalid reading time");
    if (at.getTime() > Date.now() + 60_000) return toast.error("Reading time cannot be in the future");
    if (imp < 0 || exp < 0) return toast.error("Import/export must be non-negative");
    if (imp > 10_000_000) return toast.error("Import value looks out of range (> 10 GWh)");
    // SLP outlier warning vs expected monthly avg
    const { data: mp } = await supabase.from("metering_points")
      .select("annual_consumption_mwh,consumer_category").eq("id", mpId).maybeSingle();
    if (mp?.annual_consumption_mwh) {
      const monthlyAvgKwh = (Number(mp.annual_consumption_mwh) * 1000) / 12;
      if (imp > monthlyAvgKwh * 5) {
        toast.warning(`Reading ${imp.toFixed(0)} kWh is 5× higher than monthly average (${monthlyAvgKwh.toFixed(0)} kWh) — saved as pending`);
      }
    }
    const { error } = await supabase.from("meter_readings").insert({
      metering_point_id: mpId,
      reading_at: at.toISOString(),
      import_kwh: imp,
      export_kwh: exp,
      source: String(form.get("source")),
      notes: form.get("notes") as string || null,
      created_by: user!.id,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Reading recorded"); setOpen(false); load();
  };

  const [syncing, setSyncing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [tab, setTab] = useState<"registers" | "dso">("registers");
  const [dsoRows, setDsoRows] = useState<any[]>([]);
  const [mpNames, setMpNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (tab !== "dso") return;
    (async () => {
      const [{ data: d }, { data: mps }] = await Promise.all([
        supabase.from("consumption_readings").select("*").in("source", ["DSO_MONTHLY", "DSO_INTERVAL"]).order("reading_at", { ascending: false }).limit(200),
        supabase.from("metering_points").select("id, edu_code"),
      ]);
      setDsoRows(d ?? []);
      setMpNames(new Map(((mps ?? []) as any[]).map(m => [m.id, m.edu_code])));
    })();
  }, [tab]);
  const runVee = async () => {
    setValidating(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-readings", { body: { window_hours: 72 } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Validation failed");
      toast.success(`VEE: ${data.registers_validated} validated, ${data.registers_flagged} registers flagged, ${data.intervals_flagged} intervals flagged, ${data.gaps_estimated} gaps estimated`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Validation failed");
    } finally {
      setValidating(false);
    }
  };
  const syncKimi = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-kimi-meters", { body: { window_minutes: 1440, bucket_minutes: 60 } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Sync failed");
      toast.success(`Kimi sync: ${data.readings_synced} register reads, ${data.intervals_synced} interval rows (${data.meters} meters)`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Kimi sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("meter_readings").update({ validation_status: status, validated_by: user!.id, validated_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const filtered = filterMp === 'all' ? rows : rows.filter(r => r.metering_point_id === filterMp);

  return (
    <ErpLayout title="Meter Readings" subtitle="Consumption data feeding the billing engine"
      actions={<>
        <Button variant="outline" onClick={runVee} disabled={validating}>
          <ShieldCheck className="h-4 w-4 mr-2" />{validating ? "Validating…" : "Validate (VEE)"}
        </Button>
        <Button variant="outline" onClick={syncKimi} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing…" : "Sync from Kimi"}
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />Add reading</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New meter reading</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2"><Label>Supply point</Label>
                <Select name="metering_point_id" required><SelectTrigger><SelectValue placeholder="Select supply point" /></SelectTrigger>
                  <SelectContent>{mps.map(m => <SelectItem key={m.id} value={m.id}>{m.edu_code}</SelectItem>)}</SelectContent></Select>
              </div>
              <F name="reading_at" label="Reading time" type="datetime-local" required />
              <div className="space-y-2"><Label>Source</Label>
                <Select name="source" defaultValue="manual"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem><SelectItem value="import">File import</SelectItem><SelectItem value="api">API / MDM</SelectItem><SelectItem value="estimated">Estimated</SelectItem>
                  </SelectContent></Select>
              </div>
              <F name="import_kwh" label="Import (kWh)" type="number" step="0.001" required />
              <F name="export_kwh" label="Export (kWh)" type="number" step="0.001" defaultValue="0" />
              <F name="notes" label="Notes" className="col-span-2" />
              <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Save reading</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </>}>
      <div className="flex items-center gap-2 mb-1">
        <Button size="sm" variant={tab === "registers" ? "default" : "outline"} onClick={() => setTab("registers")}>Register reads</Button>
        <Button size="sm" variant={tab === "dso" ? "default" : "outline"} onClick={() => setTab("dso")}>DSO imports (official)</Button>
      </div>
      {tab === "dso" ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Official DSO/EVN reads</CardTitle>
            <CardDescription>Interval energy imported via import-dso-reads — the legal basis for billing and settlement. Rejected rows never land here; corrections are logged via overwrite.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Metering point (EDU)</TableHead><TableHead>Period</TableHead>
                <TableHead className="text-right">kWh</TableHead><TableHead>Source</TableHead><TableHead>Quality</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {dsoRows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{mpNames.get(r.metering_point_id) ?? r.metering_point_id?.slice(0, 8)}</TableCell>
                    <TableCell className="tabular-nums">{new Date(r.reading_at).toISOString().slice(0, 10)}</TableCell>
                    <TableCell className="text-right tabular-nums">{(Number(r.actual_mwh) * 1000).toFixed(0)}</TableCell>
                    <TableCell><Badge variant="secondary" className="text-[10px]">{r.source}</Badge></TableCell>
                    <TableCell><Badge variant={r.quality === "flagged" ? "destructive" : "outline"} className="text-[10px]">{r.quality ?? "measured"}</Badge></TableCell>
                  </TableRow>
                ))}
                {dsoRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No DSO imports yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (<>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Filter:</Label>
        <Select value={filterMp} onValueChange={setFilterMp}>
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All supply points</SelectItem>
            {mps.map(m => <SelectItem key={m.id} value={m.id}>{m.edu_code}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card className="border-border/60"><CardHeader><CardTitle>Readings ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Time</TableHead><TableHead>Supply point</TableHead><TableHead className="text-right">Import (kWh)</TableHead><TableHead className="text-right">Export (kWh)</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(r => {
                const mp = mps.find(m => m.id === r.metering_point_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.reading_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{mp?.edu_code ?? '—'}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.import_kwh, 3)}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.export_kwh, 3)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{r.source}</Badge></TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.validation_status] as any}>{r.validation_status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {r.validation_status === 'pending' && (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setStatus(r.id, 'validated')}><Check className="h-4 w-4 text-primary" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => setStatus(r.id, 'rejected')}><X className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">No readings yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </>)}
    </ErpLayout>
  );
}

function F(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...rest } = props;
  return <div className={`space-y-2 ${className ?? ""}`}><Label htmlFor={rest.name}>{label}</Label><Input id={rest.name} {...rest} /></div>;
}