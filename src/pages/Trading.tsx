import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { fmtEur, fmtNum } from "@/lib/format";
import { ArrowDownCircle, ArrowUpCircle, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";

type Nom = { id: string; trade_date: string; side: "buy"|"sell"; counterparty: string | null; volume_mwh: number; price_eur_mwh: number; balancing_cost_eur: number; notes: string | null };

export default function Trading() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Nom[]>([]);
  const load = async () => {
    const { data } = await supabase.from("nominations").select("*").order("trade_date", { ascending: false }).limit(100);
    setRows((data as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const add = async (form: FormData) => {
    const { error } = await supabase.from("nominations").insert({
      user_id: user!.id,
      trade_date: String(form.get("trade_date")),
      side: String(form.get("side")) as "buy" | "sell",
      counterparty: form.get("counterparty") || null,
      volume_mwh: Number(form.get("volume_mwh")),
      price_eur_mwh: Number(form.get("price_eur_mwh")),
      balancing_cost_eur: Number(form.get("balancing_cost_eur") || 0),
      notes: form.get("notes") || null,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Nomination saved"); load();
  };

  const buys = rows.filter(r => r.side === "buy");
  const sells = rows.filter(r => r.side === "sell");
  const buyVol = buys.reduce((s,r)=>s+Number(r.volume_mwh),0);
  const sellVol = sells.reduce((s,r)=>s+Number(r.volume_mwh),0);
  const buyCost = buys.reduce((s,r)=>s+Number(r.volume_mwh)*Number(r.price_eur_mwh),0);
  const sellRev = sells.reduce((s,r)=>s+Number(r.volume_mwh)*Number(r.price_eur_mwh),0);
  const balancing = rows.reduce((s,r)=>s+Number(r.balancing_cost_eur),0);
  const pnl = sellRev - buyCost - balancing;

  return (
    <ErpLayout title="Trading & Logistics" subtitle="Nominated energy quantities and balancing costs">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Buy volume" value={`${fmtNum(buyVol)} MWh`} icon={<ArrowDownCircle className="h-4 w-4 text-accent" />} />
        <Stat label="Sell volume" value={`${fmtNum(sellVol)} MWh`} icon={<ArrowUpCircle className="h-4 w-4 text-primary" />} />
        <Stat label="Buy cost" value={fmtEur(buyCost)} />
        <Stat label="Sell revenue" value={fmtEur(sellRev)} />
        <Stat label="Net P&L" value={fmtEur(pnl)} accent={pnl >= 0 ? "primary" : "destructive"} />
      </div>

      <Card className="border-border/60">
        <CardHeader><CardTitle>New nomination</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); (e.target as HTMLFormElement).reset(); }} className="grid grid-cols-2 md:grid-cols-7 gap-3 items-end">
            <div className="space-y-2"><Label>Date</Label><Input name="trade_date" type="date" required defaultValue={format(new Date(), "yyyy-MM-dd")} /></div>
            <div className="space-y-2">
              <Label>Side</Label>
              <Select name="side" defaultValue="buy">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="buy">Buy</SelectItem><SelectItem value="sell">Sell</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Counterparty</Label><Input name="counterparty" placeholder="MAVIR / EEX / OTC" /></div>
            <div className="space-y-2"><Label>Volume (MWh)</Label><Input name="volume_mwh" type="number" step="0.01" required /></div>
            <div className="space-y-2"><Label>Price (€/MWh)</Label><Input name="price_eur_mwh" type="number" step="0.01" required /></div>
            <div className="space-y-2"><Label>Balancing (€)</Label><Input name="balancing_cost_eur" type="number" step="0.01" defaultValue="0" /></div>
            <Button type="submit" style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />Save</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Recent nominations</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Side</TableHead><TableHead>Counterparty</TableHead>
                <TableHead className="text-right">Volume</TableHead><TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Notional</TableHead><TableHead className="text-right">Balancing</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{r.trade_date}</TableCell>
                  <TableCell><Badge className={r.side === "buy" ? "bg-accent/20 text-accent border-accent/30" : "bg-primary/20 text-primary border-primary/30"}>{r.side.toUpperCase()}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{r.counterparty ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.volume_mwh)}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.price_eur_mwh)} €</TableCell>
                  <TableCell className="text-right">{fmtEur(Number(r.volume_mwh)*Number(r.price_eur_mwh))}</TableCell>
                  <TableCell className="text-right text-warning">{fmtEur(r.balancing_cost_eur)}</TableCell>
                  <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={async () => { await supabase.from("nominations").delete().eq("id", r.id); load(); }}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">No nominations yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function Stat({ label, value, icon, accent }: { label: string; value: string; icon?: React.ReactNode; accent?: "primary"|"destructive" }) {
  const tone = accent === "destructive" ? "text-destructive" : accent === "primary" ? "text-primary" : "";
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">{icon}{label}</div>
        <div className={`text-xl font-semibold mt-1 ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}