import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";

export default function PortalEdus() {
  const { user } = useAuth();
  const [mps, setMps] = useState<any[]>([]);
  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    const { data } = await supabase.from("metering_points").select("*").eq("client_id", cl.id);
    setMps(data ?? []);
  })(); }, [user]);
  return (
    <PortalLayout title="My supply points">
      <Card className="border-border/60"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>EDU</TableHead><TableHead>Address</TableHead><TableHead>Category</TableHead><TableHead>Connected power</TableHead></TableRow></TableHeader>
          <TableBody>
            {mps.map(m => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.edu_code}</TableCell>
                <TableCell className="text-sm">{m.address ?? "—"}</TableCell>
                <TableCell><Badge variant="secondary">{m.consumer_category ?? "—"}</Badge></TableCell>
                <TableCell className="text-sm">{m.connected_power_kw ? `${m.connected_power_kw} kW` : "—"}</TableCell>
              </TableRow>
            ))}
            {mps.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-10 text-sm text-muted-foreground">No supply points</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </PortalLayout>
  );
}