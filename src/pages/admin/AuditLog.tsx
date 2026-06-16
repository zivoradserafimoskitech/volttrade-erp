import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

type Row = { id: string; table_name: string; record_id: string | null; action: string; user_id: string | null; before_data: any; after_data: any; created_at: string };

export default function AuditLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => setRows((data as any) ?? []));
  }, []);

  const filtered = rows.filter(r => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return r.table_name.toLowerCase().includes(q) || r.action.toLowerCase().includes(q) || (r.record_id ?? "").toLowerCase().includes(q);
  });

  const badgeFor = (a: string) =>
    a === "INSERT" || a === "create" ? "default" :
    a === "UPDATE" || a === "update" ? "secondary" :
    a === "DELETE" || a === "delete" ? "destructive" : "outline";

  return (
    <ErpLayout title="Audit Log" subtitle="System-wide change history (latest 500)">
      <RoleGate roles={['admin','auditor']}>
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Every insert / update / delete tracked in the database</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder="Filter by table, action or record id…" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-sm" />
            <div className="border rounded-md">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Time</TableHead><TableHead>Table</TableHead><TableHead>Action</TableHead>
                  <TableHead>Record</TableHead><TableHead>User</TableHead><TableHead>Changes</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}</TableCell>
                      <TableCell className="font-mono text-xs">{r.table_name}</TableCell>
                      <TableCell><Badge variant={badgeFor(r.action) as any} className="capitalize">{r.action}</Badge></TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">{r.record_id ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">{r.user_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.before_data || r.after_data ? (
                          <details>
                            <summary className="cursor-pointer text-primary">view diff</summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-[10px] overflow-auto max-h-48 max-w-md">{JSON.stringify({ before: r.before_data, after: r.after_data }, null, 2)}</pre>
                          </details>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">No audit entries.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </RoleGate>
    </ErpLayout>
  );
}