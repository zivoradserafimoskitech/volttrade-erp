import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtNum } from "@/lib/format";
import { renderInvoicePdf, detectInvoiceLang } from "@/lib/invoiceTemplates";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function PortalInvoices() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [client, setClient] = useState<any>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients")
      .select("id, company_name, contract_type, fixed_price_eur_mwh, margin_eur_mwh, country_code")
      .eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    setClient(cl);
    const { data } = await supabase.from("invoices").select("*").eq("client_id", cl.id).order("period_end", { ascending: false });
    setRows(data ?? []);
  })(); }, [user]);

  const download = async (inv: any) => {
    if (!client) return;
    setDownloading(inv.id);
    try {
      const { data: meters } = await supabase.from("metering_points").select("id, edu_code, address").eq("client_id", client.id);
      const meterIds = (meters ?? []).map((m: any) => m.id);
      const startISO = new Date(inv.period_start).toISOString();
      const endISO = new Date(new Date(inv.period_end).getTime() + 24 * 3600 * 1000 - 1).toISOString();
      const { data: readings } = meterIds.length
        ? await supabase.from("consumption_readings").select("reading_at, actual_mwh, metering_point_id")
            .in("metering_point_id", meterIds).gte("reading_at", startISO).lte("reading_at", endISO)
        : { data: [] as any[] };
      await renderInvoicePdf({
        inv, client,
        meters: (meters ?? []) as any,
        readings: (readings ?? []) as any,
        lang: detectInvoiceLang(client.country_code),
      });
    } catch {
      toast.error("Преземањето на фактурата не успеа");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <PortalLayout title="Invoices">
      <Card className="border-border/60"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Issued</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(i => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-xs">{i.invoice_number}</TableCell>
                <TableCell className="text-xs">{i.period_end ?? (i.created_at ? String(i.created_at).slice(0, 10) : "")}</TableCell>
                <TableCell className="text-xs">{i.due_date}</TableCell>
                <TableCell className="text-right">€{fmtNum(i.total_eur)}</TableCell>
                <TableCell><Badge variant={i.status === "paid" ? "default" : "secondary"}>{i.status}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => download(i)} disabled={downloading === i.id}>
                    {downloading === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">No invoices</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </PortalLayout>
  );
}