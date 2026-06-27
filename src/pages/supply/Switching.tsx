import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Send, Download, Gift, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

const DSO_STAGES = ["draft", "req_sent", "ack", "confirmed", "rejected"];

export default function Switching() {
  return (
    <ErpLayout title="Switching" subtitle="Change-of-supplier requests in & out">
      <RoleGate roles={["admin", "management", "supply_manager"]}><Inner /></RoleGate>
    </ErpLayout>
  );
}

function Inner() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("switch_requests").select("*").order("created_at", { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const add = async (form: FormData) => {
    const { error } = await supabase.from("switch_requests").insert({
      user_id: user!.id,
      edu_code: String(form.get("edu_code")),
      direction: String(form.get("direction")),
      current_supplier: form.get("current_supplier") as string || null,
      new_supplier: form.get("new_supplier") as string || null,
      requested_date: form.get("requested_date") as string || null,
      volume_estimate_mwh: Number(form.get("volume_estimate_mwh") || 0),
      dso_status: "draft",
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Created"); setOpen(false); load();
  };

  const sendDso = async (r: any) => {
    try {
      const { data, error } = await supabase.functions.invoke("dso-switch-message", { body: r });
      if (error) throw error;
      await supabase.from("switch_requests").update({ dso_status: "req_sent", message_envelope: data.envelope }).eq("id", r.id);
      toast.success(`Sent ${data.message_id}`); load();
    } catch (e: any) { toast.error(e.message ?? String(e)); }
  };

  const downloadXml = (r: any) => {
    if (!r.message_envelope) return;
    const blob = new Blob([r.message_envelope], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `switch-${r.edu_code}.xml`; a.click(); URL.revokeObjectURL(url);
  };

  const setStatus = async (id: string, status: string) => {
    const upd: any = { dso_status: status };
    if (status === "confirmed") upd.confirmed_date = new Date().toISOString().slice(0, 10);
    if (status === "rejected") upd.lost_reason = prompt("Reason?") ?? null;
    await supabase.from("switch_requests").update(upd).eq("id", id);
    load();
  };

  const winBack = async (r: any) => {
    const disc = Number(prompt("Discount €/MWh offered?", "5"));
    if (!disc) return;
    await supabase.from("switch_requests").update({ win_back_offered: true, win_back_discount_eur_mwh: disc }).eq("id", r.id);
    toast.success("Win-back logged"); load();
  };

  const inRows = rows.filter(r => r.direction === "in");
  const outRows = rows.filter(r => r.direction === "out");

  const chartData = useMemo(() => {
    const map: Record<string, { month: string; in_mwh: number; out_mwh: number }> = {};
    rows.forEach(r => {
      const d = r.confirmed_date ?? r.requested_date ?? r.created_at?.slice(0, 10);
      if (!d) return;
      const m = d.slice(0, 7);
      map[m] ??= { month: m, in_mwh: 0, out_mwh: 0 };
      if (r.dso_status === "confirmed") {
        if (r.direction === "in") map[m].in_mwh += Number(r.volume_estimate_mwh || 0);
        else map[m].out_mwh += Number(r.volume_estimate_mwh || 0);
      }
    });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }, [rows]);

  const churn = useMemo(() => {
    const confirmedOut = outRows.filter(r => r.dso_status === "confirmed").length;
    const total = outRows.length || 1;
    return (confirmedOut / total) * 100;
  }, [outRows]);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Switch-in active" value={String(inRows.filter(r => !["confirmed", "rejected"].includes(r.dso_status)).length)} />
        <Kpi label="Switch-out active" value={String(outRows.filter(r => !["confirmed", "rejected"].includes(r.dso_status)).length)} />
        <Kpi label="Churn (out)" value={`${churn.toFixed(0)}%`} />
        <Kpi label="Win-back active" value={String(rows.filter(r => r.win_back_offered).length)} />
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-sm">Confirmed gain / loss (last 12 months, MWh)</CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New request</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New switch request</DialogTitle></DialogHeader>
              <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
                <F name="edu_code" label="EDU code" required />
                <div className="space-y-2"><Label>Direction</Label>
                  <Select name="direction" defaultValue="in"><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="in">Switch-in (gaining)</SelectItem><SelectItem value="out">Switch-out (losing)</SelectItem></SelectContent></Select>
                </div>
                <F name="current_supplier" label="Current supplier" />
                <F name="new_supplier" label="New supplier" />
                <F name="requested_date" label="Requested date" type="date" />
                <F name="volume_estimate_mwh" label="Volume MWh/yr" type="number" step="0.01" />
                <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Create</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Legend />
              <Bar dataKey="in_mwh" fill="hsl(var(--primary))" name="Gained" />
              <Bar dataKey="out_mwh" fill="hsl(var(--destructive))" name="Lost" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Tabs defaultValue="in">
        <TabsList><TabsTrigger value="in">Switch-in ({inRows.length})</TabsTrigger><TabsTrigger value="out">Switch-out ({outRows.length})</TabsTrigger></TabsList>
        <TabsContent value="in"><Queue rows={inRows} onSend={sendDso} onDl={downloadXml} onStatus={setStatus} /></TabsContent>
        <TabsContent value="out"><Queue rows={outRows} onSend={sendDso} onDl={downloadXml} onStatus={setStatus} onWinBack={winBack} /></TabsContent>
      </Tabs>
    </>
  );
}

function Queue({ rows, onSend, onDl, onStatus, onWinBack }: any) {
  return (
    <Card className="border-border/60"><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>EDU</TableHead><TableHead>From → To</TableHead><TableHead>Date</TableHead><TableHead className="text-right">MWh</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.edu_code}</TableCell>
              <TableCell className="text-xs">{r.current_supplier ?? "—"} → {r.new_supplier ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.confirmed_date ?? r.requested_date ?? "—"}</TableCell>
              <TableCell className="text-right">{fmtNum(r.volume_estimate_mwh)}</TableCell>
              <TableCell>
                <Select value={r.dso_status} onValueChange={(v) => onStatus(r.id, v)}>
                  <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{DSO_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                {r.win_back_offered && <Badge className="ml-2 bg-amber-500">win-back €{r.win_back_discount_eur_mwh}</Badge>}
              </TableCell>
              <TableCell className="text-right">
                {r.dso_status === "draft" && <Button size="icon" variant="ghost" onClick={() => onSend(r)} title="Send DSO"><Send className="h-4 w-4" /></Button>}
                {r.message_envelope && <Button size="icon" variant="ghost" onClick={() => onDl(r)} title="Download XML"><Download className="h-4 w-4" /></Button>}
                {onWinBack && !r.win_back_offered && r.dso_status !== "confirmed" && <Button size="icon" variant="ghost" onClick={() => onWinBack(r)} title="Win-back"><Gift className="h-4 w-4 text-amber-500" /></Button>}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">No requests</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}
function Kpi({ label, value }: { label: string; value: string }) {
  return <Card className="border-border/60"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-2xl font-semibold mt-1">{value}</div></CardContent></Card>;
}
function F(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...rest } = props;
  return <div className={`space-y-2 ${className ?? ""}`}><Label htmlFor={rest.name}>{label}</Label><Input id={rest.name} {...rest} /></div>;
}