import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";

export default function PortalReadings() {
  const { user } = useAuth();
  const [mps, setMps] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [mpId, setMpId] = useState("");

  const load = async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    const { data: m } = await supabase.from("metering_points").select("id, edu_code").eq("client_id", cl.id);
    setMps(m ?? []);
    const ids = (m ?? []).map(x => x.id);
    if (ids.length) {
      const { data: r } = await supabase.from("meter_readings").select("*").in("metering_point_id", ids).order("reading_date", { ascending: false }).limit(20);
      setRows(r ?? []);
    }
  };
  useEffect(() => { load(); }, [user]);

  const submit = async (form: FormData) => {
    if (!mpId) return toast.error("Pick a supply point");
    const reading_date = String(form.get("reading_date"));
    const reading_value = Number(form.get("reading_value"));
    if (reading_value < 0) return toast.error("Negative value not allowed");
    if (new Date(reading_date) > new Date()) return toast.error("Date cannot be in the future");
    const { error } = await supabase.from("meter_readings").insert({
      metering_point_id: mpId, reading_date, reading_value, kwh_used: 0, source: "customer", is_estimated: false,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Reading submitted"); load();
  };

  return (
    <PortalLayout title="Submit meter reading">
      <Card className="border-border/60"><CardContent className="p-4">
        <form onSubmit={e => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-2"><Label>Supply point</Label>
            <Select value={mpId} onValueChange={setMpId}><SelectTrigger><SelectValue placeholder="Select EDU" /></SelectTrigger>
              <SelectContent>{mps.map(m => <SelectItem key={m.id} value={m.id}>{m.edu_code}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-2"><Label>Date</Label><Input type="date" name="reading_date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <div className="space-y-2"><Label>Reading (kWh)</Label><Input type="number" step="0.01" name="reading_value" required /></div>
          <Button type="submit" style={{ background: "var(--gradient-primary)" }}>Submit</Button>
        </form>
      </CardContent></Card>
      <Card className="border-border/60"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>EDU</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Reading</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{mps.find(m => m.id === r.metering_point_id)?.edu_code ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.reading_date}</TableCell>
                <TableCell className="text-right">{fmtNum(r.reading_value)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.source ?? "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-10 text-sm text-muted-foreground">No readings yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </PortalLayout>
  );
}