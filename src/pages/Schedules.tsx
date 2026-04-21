import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, CalendarClock, Send, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { fmtNum } from "@/lib/format";

type Sch = { id: string; schedule_number: string; tso_area: string; delivery_date: string; version: number; status: string; submitted_at: string|null; response_at: string|null };
type Line = { id: string; schedule_id: string; hour: number; direction: string; volume_mwh: number };

const STATUS_VARIANT: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  sent: "bg-primary/20 text-primary border-primary/30",
  accepted: "bg-accent/20 text-accent border-accent/30",
  rejected: "bg-destructive/20 text-destructive border-destructive/30",
};

export default function Schedules() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Sch[]>([]);
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("schedules").select("*").order("delivery_date", { ascending: false });
    setRows((data as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const loadLines = async (sid: string) => {
    const { data } = await supabase.from("schedule_lines").select("*").eq("schedule_id", sid).order("hour");
    setLines(prev => ({ ...prev, [sid]: (data as any) ?? [] }));
  };

  const toggle = async (sid: string) => {
    if (expanded === sid) { setExpanded(null); return; }
    setExpanded(sid);
    if (!lines[sid]) await loadLines(sid);
  };

  const add = async (form: FormData) => {
    const { data, error } = await supabase.from("schedules").insert({
      user_id: user!.id,
      schedule_number: String(form.get("schedule_number")),
      tso_area: String(form.get("tso_area")),
      delivery_date: String(form.get("delivery_date")),
      version: 1,
      status: "planned",
    } as any).select().single();
    if (error || !data) return toast.error(error?.message ?? "error");
    // create 24 empty hourly lines
    const dir = String(form.get("direction") || "in");
    const baseVol = Number(form.get("base_volume") || 0);
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      schedule_id: (data as any).id, hour: h, direction: dir, volume_mwh: baseVol,
    }));
    await supabase.from("schedule_lines").insert(hourly as any);
    toast.success("Schedule created with 24 hourly lines"); setOpen(false); load();
  };

  const updateLine = async (id: string, vol: number, sid: string) => {
    const { error } = await supabase.from("schedule_lines").update({ volume_mwh: vol }).eq("id", id);
    if (error) return toast.error(error.message);
    loadLines(sid);
  };

  const setStatus = async (id: string, status: string) => {
    const patch: any = { status };
    if (status === "sent") patch.submitted_at = new Date().toISOString();
    if (status === "accepted" || status === "rejected") patch.response_at = new Date().toISOString();
    const { error } = await supabase.from("schedules").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Status: ${status}`); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete schedule and all hourly lines?")) return;
    await supabase.from("schedules").delete().eq("id", id); load();
  };

  return (
    <ErpLayout title="Schedules & Nominations" subtitle="Hourly schedules per TSO area with submission tracking"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New schedule</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New schedule</DialogTitle></DialogHeader>
            <form
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const t = e.target as HTMLElement;
                  const isSubmit = t.tagName === "BUTTON" && (t as HTMLButtonElement).type === "submit";
                  if (t.tagName !== "TEXTAREA" && !isSubmit) e.preventDefault();
                }
              }}
              onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }}
              className="grid grid-cols-2 gap-3"
            >
              <div className="space-y-2"><Label>Schedule number</Label><Input name="schedule_number" required /></div>
              <div className="space-y-2"><Label>TSO area</Label><Input name="tso_area" placeholder="MAVIR / TenneT / 50Hz" required /></div>
              <div className="space-y-2"><Label>Delivery date</Label><Input name="delivery_date" type="date" required /></div>
              <div className="space-y-2">
                <Label>Direction</Label>
                <Select name="direction" defaultValue="in">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="in">In (buy)</SelectItem><SelectItem value="out">Out (sell)</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2"><Label>Default hourly volume (MWh)</Label><Input name="base_volume" type="number" step="0.01" defaultValue="0" /></div>
              <div className="col-span-2"><Button type="submit" className="w-full" style={{ background: "var(--gradient-primary)" }}>Create</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <Card className="border-border/60">
        <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />All schedules</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Number</TableHead><TableHead>TSO area</TableHead><TableHead>Delivery</TableHead>
              <TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead><TableHead>Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <>
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => toggle(r.id)}>
                    <TableCell className="font-mono text-xs">{r.schedule_number}</TableCell>
                    <TableCell>{r.tso_area}</TableCell>
                    <TableCell>{r.delivery_date}</TableCell>
                    <TableCell>v{r.version}</TableCell>
                    <TableCell><Badge className={STATUS_VARIANT[r.status]}>{r.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {r.status === "planned" && <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "sent")}><Send className="h-3 w-3 mr-1" />Submit</Button>}
                        {r.status === "sent" && <>
                          <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "accepted")}><CheckCircle2 className="h-3 w-3 mr-1 text-accent" />Accept</Button>
                          <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "rejected")}><XCircle className="h-3 w-3 mr-1 text-destructive" />Reject</Button>
                        </>}
                        <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === r.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/20 p-4">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Hourly lines (MWh)</div>
                        <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
                          {(lines[r.id] ?? []).map(l => (
                            <div key={l.id} className="space-y-1">
                              <div className="text-[10px] text-muted-foreground text-center">H{String(l.hour).padStart(2,"0")}</div>
                              <Input type="number" step="0.01" defaultValue={Number(l.volume_mwh)} className="h-8 text-xs"
                                onBlur={e => { const v = Number(e.target.value); if (v !== Number(l.volume_mwh)) updateLine(l.id, v, r.id); }} />
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          Total: <span className="text-foreground font-semibold">{fmtNum((lines[r.id] ?? []).reduce((s,l) => s + Number(l.volume_mwh), 0))} MWh</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">No schedules yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}
