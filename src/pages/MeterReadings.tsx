import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Plus, Check, X } from "lucide-react";
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
    const { error } = await supabase.from("meter_readings").insert({
      metering_point_id: String(form.get("metering_point_id")),
      reading_at: new Date(String(form.get("reading_at"))).toISOString(),
      import_kwh: Number(form.get("import_kwh") || 0),
      export_kwh: Number(form.get("export_kwh") || 0),
      source: String(form.get("source")),
      notes: form.get("notes") as string || null,
      created_by: user!.id,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Reading recorded"); setOpen(false); load();
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("meter_readings").update({ validation_status: status, validated_by: user!.id, validated_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const filtered = filterMp === 'all' ? rows : rows.filter(r => r.metering_point_id === filterMp);

  return (
    <ErpLayout title="Meter Readings" subtitle="Consumption data feeding the billing engine"
      actions={
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
      }>
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
    </ErpLayout>
  );
}

function F(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...rest } = props;
  return <div className={`space-y-2 ${className ?? ""}`}><Label htmlFor={rest.name}>{label}</Label><Input id={rest.name} {...rest} /></div>;
}