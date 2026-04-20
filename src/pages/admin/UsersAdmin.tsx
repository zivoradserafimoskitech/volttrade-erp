import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, AppRole } from "@/lib/auth";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const ROLES: AppRole[] = ['admin','management','trader','supply_manager','billing_officer','finance','risk_officer','operations','auditor'];

export default function UsersAdmin() {
  const { refreshRoles } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<AppRole>('trader');

  const load = async () => { const { data } = await supabase.from("user_roles").select("*").order("created_at", { ascending: false }); setRows(data ?? []); };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!userId) return toast.error("Enter a user ID");
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) return toast.error(error.message);
    toast.success("Role assigned"); setUserId(""); load(); refreshRoles();
  };
  const del = async (id: string) => { const { error } = await supabase.from("user_roles").delete().eq("id", id); if (error) return toast.error(error.message); load(); refreshRoles(); };

  return (
    <ErpLayout title="Users & Roles" subtitle="Assign system roles to authenticated users">
      <RoleGate roles={['admin']}>
        <Card className="border-border/60">
          <CardHeader><CardTitle>Assign role</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2 space-y-2"><Label>User ID (auth.users.id)</Label><Input value={userId} onChange={e => setUserId(e.target.value)} placeholder="uuid…" /></div>
            <div className="space-y-2"><Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
            </div>
            <Button onClick={add} className="col-span-3" style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />Assign</Button>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader><CardTitle>Assignments ({rows.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>User ID</TableHead><TableHead>Role</TableHead><TableHead>Assigned</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.user_id}</TableCell>
                    <TableCell><Badge>{r.role}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-10 text-sm text-muted-foreground">No role assignments yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </RoleGate>
    </ErpLayout>
  );
}