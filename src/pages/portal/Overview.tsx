import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtNum } from "@/lib/format";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function PortalOverview() {
  const { user } = useAuth();
  const [client, setClient] = useState<any>(null);
  const [contract, setContract] = useState<any>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [series, setSeries] = useState<any[]>([]);

  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("*").eq("portal_user_id", user.id).maybeSingle();
    setClient(cl);
    if (!cl) return;
    const { data: c } = await supabase.from("supply_contracts").select("*").eq("client_id", cl.id).eq("status", "active").limit(1).maybeSingle();
    setContract(c);
    const { data: inv } = await supabase.from("invoices")
      .select("*").eq("client_id", cl.id)
      .in("status", ["draft", "issued", "overdue"])
      .order("due_date", { ascending: true }).limit(1).maybeSingle();
    setInvoice(inv);
    const { data: mps } = await supabase.from("metering_points").select("id").eq("client_id", cl.id);
    const ids = (mps ?? []).map(m => m.id);
    if (ids.length) {
      const { data: rd } = await supabase.from("meter_readings").select("reading_date, kwh_used").in("metering_point_id", ids);
      const map: Record<string, number> = {};
      (rd ?? []).forEach((r: any) => { const m = r.reading_date?.slice(0, 7); if (!m) return; map[m] = (map[m] ?? 0) + Number(r.kwh_used || 0); });
      setSeries(Object.entries(map).sort().slice(-12).map(([month, kwh]) => ({ month, kwh })));
    }
  })(); }, [user]);

  if (!client) return <PortalLayout title="Welcome"><Card className="border-border/60"><CardContent className="p-8 text-center text-sm text-muted-foreground">Your account isn't linked to a customer record yet. Please contact your account manager.</CardContent></Card></PortalLayout>;

  return (
    <PortalLayout title={`Hello, ${client.company_name}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label="Active contract" value={contract?.contract_number ?? "—"} sub={contract ? `${fmtNum(contract.annual_volume_mwh)} MWh / year` : "No active contract"} />
        <Stat label="Next invoice due" value={invoice ? `€${fmtNum(invoice.total_eur)}` : "—"} sub={invoice?.due_date ?? "—"} />
        <Stat label="Last 12m consumption" value={`${fmtNum(series.reduce((s, x) => s + x.kwh, 0) / 1000)} MWh`} />
      </div>
      <Card className="border-border/60"><CardHeader><CardTitle className="text-sm">Monthly consumption (kWh)</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
              <Area type="monotone" dataKey="kwh" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} /></AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </PortalLayout>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Card className="border-border/60"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-2xl font-semibold mt-1">{value}</div>{sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}</CardContent></Card>;
}