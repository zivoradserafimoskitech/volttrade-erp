import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtNum } from "@/lib/format";

export default function PortalInvoices() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    const { data } = await supabase.from("invoices").select("*").eq("client_id", cl.id).order("issue_date", { ascending: false });
    setRows(data ?? []);
  })(); }, [user]);
  return (
    <PortalLayout title="Invoices">
      <Card className="border-border/60"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Issued</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(i => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-xs">{i.invoice_number}</TableCell>
                <TableCell className="text-xs">{i.issue_date}</TableCell>
                <TableCell className="text-xs">{i.due_date}</TableCell>
                <TableCell className="text-right">€{fmtNum(i.total_eur)}</TableCell>
                <TableCell><Badge variant={i.status === "paid" ? "default" : "secondary"}>{i.status}</Badge></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm text-muted-foreground">No invoices</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </PortalLayout>
  );
}