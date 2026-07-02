import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock } from "lucide-react";

type App = {
  id: string; user_email: string; pod_code: string; status: "pending" | "approved" | "rejected";
  client_id: string | null; note: string | null; created_at: string; decided_at: string | null;
  clients?: { company_name: string | null } | null;
};

export default function ConsumerApplicationsPage() {
  return (
    <ErpLayout title="Vatra applications" subtitle="Approve or reject consumer sign-ups before they get portal access">
      <RoleGate roles={["admin", "supply_manager"]}><Inner /></RoleGate>
    </ErpLayout>
  );
}

function Inner() {
  const [rows, setRows] = useState<App[]>([]);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    let q = supabase.from("consumer_applications")
      .select("id, user_email, pod_code, status, client_id, note, created_at, decided_at, clients(company_name)")
      .order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) return toast.error(error.message);
    setRows((data ?? []) as any);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const decide = async (row: App, decision: "approve" | "reject") => {
    setBusyId(row.id);
    const { data, error } = await supabase.functions.invoke("decide-consumer-application", {
      body: { application_id: row.id, decision, note: notes[row.id] ?? null },
    });
    setBusyId(null);
    if (error || (data as any)?.error) return toast.error((data as any)?.error ?? error?.message ?? "Failed");
    toast.success(decision === "approve" ? "Approved — portal access granted" : "Rejected");
    load();
  };

  const statusBadge = (s: string) => {
    if (s === "pending") return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
    if (s === "approved") return <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3" />Approved</Badge>;
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Rejected</Badge>;
  };

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="border-border/60"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Applicant</TableHead>
            <TableHead>POD / EIC</TableHead>
            <TableHead>Matched customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead className="w-[360px]">Decision</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No applications.</TableCell></TableRow>
            )}
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.user_email}</TableCell>
                <TableCell className="font-mono text-xs">{r.pod_code}</TableCell>
                <TableCell className="text-xs">{r.clients?.company_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{statusBadge(r.status)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell>
                  {r.status === "pending" ? (
                    <div className="space-y-2">
                      <Textarea rows={2} placeholder="Optional note (visible to auditors)"
                        value={notes[r.id] ?? ""} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busyId === r.id} onClick={() => decide(r, "approve")}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busyId === r.id} onClick={() => decide(r, "reject")}>
                          <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {r.decided_at ? `Decided ${new Date(r.decided_at).toLocaleString()}` : "—"}
                      {r.note ? <div className="mt-1 italic">"{r.note}"</div> : null}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}