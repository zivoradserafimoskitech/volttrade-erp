import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtNum } from "@/lib/format";
import { exportToPdf } from "@/lib/exports";
import { FileText } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  virtual_sleeved: "Virtual / Sleeved",
  pay_as_produced: "Pay-as-produced",
  surplus_buyback: "Surplus buy-back",
};

export default function PortalPpa() {
  const { user } = useAuth();
  const [ppas, setPpas] = useState<any[]>([]);
  const [settles, setSettles] = useState<any[]>([]);

  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id,company_name").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    const { data: ps } = await supabase.from("ppa_agreements").select("*").eq("client_id", cl.id);
    setPpas(ps ?? []);
    if (ps && ps.length) {
      const { data: ss } = await supabase.from("ppa_settlements").select("*").in("ppa_id", ps.map(p => p.id)).order("period_month", { ascending: false });
      setSettles(ss ?? []);
    }
  })(); }, [user]);

  const downloadStatement = (s: any) => {
    const p = ppas.find(x => x.id === s.ppa_id); if (!p) return;
    exportToPdf({
      title: `PPA Monthly Statement · ${p.ppa_code}`,
      subtitle: `${String(s.period_month).slice(0, 7)}`,
      filename: `ppa-${p.ppa_code}-${String(s.period_month).slice(0, 7)}`,
      sections: [{
        heading: `${TYPE_LABEL[p.ppa_type]} — applied price € ${Number(s.applied_price_eur_mwh).toFixed(2)}/MWh`,
        columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }],
        rows: [
          { metric: "Produced (MWh)", value: fmtNum(s.produced_mwh) },
          { metric: "Delivered (MWh)", value: fmtNum(s.delivered_mwh) },
          { metric: "Surplus exported (MWh)", value: fmtNum(s.surplus_export_mwh) },
          { metric: "Energy cost (€)", value: `€ ${fmtNum(s.energy_cost_eur)}` },
          { metric: "Buy-back credit (€)", value: `€ ${fmtNum(s.buyback_credit_eur)}` },
        ],
        totals: { metric: "Net amount (€)", value: `€ ${Number(s.net_amount_eur).toFixed(2)}` },
      }],
    });
  };

  return (
    <PortalLayout title="My PPA agreements">
      <Card className="border-border/60">
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>PPA</TableHead><TableHead>Type</TableHead><TableHead>Term</TableHead>
              <TableHead className="text-right">Fixed €/MWh</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {ppas.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.ppa_code}</TableCell>
                  <TableCell><Badge variant="secondary">{TYPE_LABEL[p.ppa_type]}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.start_date} → {p.end_date}</TableCell>
                  <TableCell className="text-right">{fmtNum(p.fixed_price_eur_mwh)}</TableCell>
                  <TableCell><Badge>{p.status}</Badge></TableCell>
                </TableRow>
              ))}
              {ppas.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">No PPA agreements on your account</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold mt-6">Monthly statements</h2>
      <Card className="border-border/60"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Month</TableHead><TableHead>PPA</TableHead>
            <TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Surplus</TableHead>
            <TableHead className="text-right">Net €</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {settles.map(s => {
              const p = ppas.find(x => x.id === s.ppa_id);
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{String(s.period_month).slice(0, 7)}</TableCell>
                  <TableCell className="font-mono text-xs">{p?.ppa_code}</TableCell>
                  <TableCell className="text-right">{fmtNum(s.delivered_mwh)}</TableCell>
                  <TableCell className="text-right">{fmtNum(s.surplus_export_mwh)}</TableCell>
                  <TableCell className="text-right font-semibold">€ {fmtNum(s.net_amount_eur)}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => downloadStatement(s)}><FileText className="h-4 w-4 mr-1" />PDF</Button></TableCell>
                </TableRow>
              );
            })}
            {settles.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">No statements yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </PortalLayout>
  );
}