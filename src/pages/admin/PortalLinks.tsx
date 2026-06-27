import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function PortalLinks() {
  return (
    <ErpLayout title="Portal access" subtitle="Link customers to their portal login (auth user id)">
      <RoleGate roles={["admin", "supply_manager"]}><Inner /></RoleGate>
    </ErpLayout>
  );
}
function Inner() {
  const [rows, setRows] = useState<any[]>([]);
  const load = async () => { const { data } = await supabase.from("clients").select("id,company_name,contact_email,portal_user_id").order("company_name"); setRows(data ?? []); };
  useEffect(() => { load(); }, []);
  const update = async (id: string, uid: string) => {
    const v = uid.trim() || null;
    const { error } = await supabase.from("clients").update({ portal_user_id: v }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Linked"); load();
  };
  return (
    <Card className="border-border/60"><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Email</TableHead><TableHead>Portal user id</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id}>
              <TableCell>{r.company_name}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.contact_email ?? "—"}</TableCell>
              <TableCell><Input defaultValue={r.portal_user_id ?? ""} placeholder="auth user uuid" id={`u-${r.id}`} className="font-mono text-xs" /></TableCell>
              <TableCell><Button size="sm" onClick={() => update(r.id, (document.getElementById(`u-${r.id}`) as HTMLInputElement).value)}>Save</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="p-4 text-xs text-muted-foreground">Customer must sign up at <code>/auth</code> first, then paste their auth user id here (Admin → Users & Roles shows it).</div>
    </CardContent></Card>
  );
}