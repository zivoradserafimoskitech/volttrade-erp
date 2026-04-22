import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { fmtEur, fmtNum } from "@/lib/format";
import { Plus, Trash2, ArrowDownCircle, ArrowUpCircle, Activity, Download, FileSpreadsheet, FileText } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportToExcel, exportToPdf, type ExportColumn } from "@/lib/exports";
import { format } from "date-fns";

type Trade = {
  id: string; trade_number: string; counterparty_id: string|null; trading_contract_id: string|null;
  market: string; side: string; delivery_start: string; delivery_end: string;
  hub: string|null; volume_mwh: number; price_eur_mwh: number; total_value_eur: number;
  trader: string|null; status: string;
};
type Cp = { id: string; legal_name: string };
type Tc = { id: string; contract_number: string; counterparty_id: string };

const MARKETS = ["bilateral","OTC","day_ahead","intraday","balancing","PPA"];
const STATUSES = ["draft","confirmed","nominated","settled","cancelled"];
const STATUS_TONE: Record<string,string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-primary/20 text-primary border-primary/30",
  nominated: "bg-accent/20 text-accent border-accent/30",
  settled: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
};

export default function Trading() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Trade[]>([]);
  const [cps, setCps] = useState<Cp[]>([]);
  const [tcs, setTcs] = useState<Tc[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<{ side: string; status: string; market: string }>({ side: "all", status: "all", market: "all" });
  const [selectedCp, setSelectedCp] = useState<string>("");

  const load = async () => {
    const { data } = await supabase.from("trades").select("*").order("delivery_start", { ascending: false }).limit(200);
    const { data: c } = await supabase.from("counterparties").select("id,legal_name").order("legal_name");
    const { data: t } = await supabase.from("trading_contracts").select("id,contract_number,counterparty_id");
    setRows((data as any) ?? []); setCps((c as any) ?? []); setTcs((t as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const add = async (form: FormData) => {
    const dStart = String(form.get("delivery_start"));
    const dEnd = String(form.get("delivery_end"));
    const { error } = await supabase.from("trades").insert({
      user_id: user!.id,
      trade_number: String(form.get("trade_number")),
      counterparty_id: form.get("counterparty_id") || null,
      trading_contract_id: form.get("trading_contract_id") || null,
      market: String(form.get("market")),
      side: String(form.get("side")),
      delivery_start: dStart, delivery_end: dEnd,
      hub: form.get("hub") || null,
      volume_mwh: Number(form.get("volume_mwh")),
      price_eur_mwh: Number(form.get("price_eur_mwh")),
      trader: form.get("trader") || null,
      status: String(form.get("status") || "draft"),
      notes: form.get("notes") || null,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Trade booked"); setOpen(false); load();
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("trades").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete trade?")) return;
    await supabase.from("trades").delete().eq("id", id); load();
  };

  const filtered = useMemo(() => rows.filter(r =>
    (filter.side === "all" || r.side === filter.side) &&
    (filter.status === "all" || r.status === filter.status) &&
    (filter.market === "all" || r.market === filter.market)
  ), [rows, filter]);

  const buys = filtered.filter(r => r.side === "buy" && r.status !== "cancelled");
  const sells = filtered.filter(r => r.side === "sell" && r.status !== "cancelled");
  const buyVol = buys.reduce((s,r)=>s+Number(r.volume_mwh),0);
  const sellVol = sells.reduce((s,r)=>s+Number(r.volume_mwh),0);
  const buyCost = buys.reduce((s,r)=>s+Number(r.total_value_eur ?? 0),0);
  const sellRev = sells.reduce((s,r)=>s+Number(r.total_value_eur ?? 0),0);
  const pnl = sellRev - buyCost;

  const cpName = (id: string|null) => id ? (cps.find(c => c.id === id)?.legal_name ?? "—") : "—";
  const filteredTcs = tcs.filter(t => !selectedCp || t.counterparty_id === selectedCp);

  return (
    <ErpLayout title="Trade Blotter" subtitle="All electricity trades across markets and counterparties"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New trade</Button></DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>Book new trade</DialogTitle></DialogHeader>
            <form
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const t = e.target as HTMLElement;
                  const isSubmit = t.tagName === "BUTTON" && (t as HTMLButtonElement).type === "submit";
                  if (t.tagName !== "TEXTAREA" && !isSubmit) e.preventDefault();
                }
              }}
              onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); }}
              className="grid grid-cols-2 gap-3"
            >
              <div className="space-y-2"><Label>Trade number</Label><Input name="trade_number" required defaultValue={`TR-${Date.now().toString().slice(-8)}`} /></div>
              <div className="space-y-2">
                <Label>Market</Label>
                <Select name="market" defaultValue="bilateral"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MARKETS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Side</Label>
                <Select name="side" defaultValue="buy"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="buy">Buy</SelectItem><SelectItem value="sell">Sell</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Counterparty</Label>
                <Select name="counterparty_id" onValueChange={setSelectedCp}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{cps.map(c => <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Trading contract</Label>
                <Select name="trading_contract_id">
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>{filteredTcs.map(t => <SelectItem key={t.id} value={t.id}>{t.contract_number}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Delivery start</Label><Input name="delivery_start" type="datetime-local" required /></div>
              <div className="space-y-2"><Label>Delivery end</Label><Input name="delivery_end" type="datetime-local" required /></div>
              <div className="space-y-2"><Label>Hub</Label><Input name="hub" placeholder="HU / DE / AT border" /></div>
              <div className="space-y-2"><Label>Trader</Label><Input name="trader" /></div>
              <div className="space-y-2"><Label>Volume (MWh)</Label><Input name="volume_mwh" type="number" step="0.01" required /></div>
              <div className="space-y-2"><Label>Price (€/MWh)</Label><Input name="price_eur_mwh" type="number" step="0.01" required /></div>
              <div className="space-y-2 col-span-2">
                <Label>Status</Label>
                <Select name="status" defaultValue="draft"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Button type="submit" className="w-full" style={{ background: "var(--gradient-primary)" }}>Book trade</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      }>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Buy volume" value={`${fmtNum(buyVol)} MWh`} icon={<ArrowDownCircle className="h-4 w-4 text-accent" />} />
        <Stat label="Sell volume" value={`${fmtNum(sellVol)} MWh`} icon={<ArrowUpCircle className="h-4 w-4 text-primary" />} />
        <Stat label="Buy notional" value={fmtEur(buyCost)} />
        <Stat label="Sell notional" value={fmtEur(sellRev)} />
        <Stat label="Net P&L" value={fmtEur(pnl)} accent={pnl >= 0 ? "primary" : "destructive"} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Activity className="h-4 w-4" />Blotter</span>
            <div className="flex gap-2 text-sm font-normal">
              <Select value={filter.market} onValueChange={(v) => setFilter(f => ({...f, market: v}))}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All markets</SelectItem>{MARKETS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filter.side} onValueChange={(v) => setFilter(f => ({...f, side: v}))}>
                <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All sides</SelectItem><SelectItem value="buy">Buy</SelectItem><SelectItem value="sell">Sell</SelectItem></SelectContent>
              </Select>
              <Select value={filter.status} onValueChange={(v) => setFilter(f => ({...f, status: v}))}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Trade #</TableHead><TableHead>Market</TableHead><TableHead>Side</TableHead>
              <TableHead>Counterparty</TableHead><TableHead>Delivery</TableHead><TableHead>Hub</TableHead>
              <TableHead className="text-right">Volume</TableHead><TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Notional</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.trade_number}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.market}</Badge></TableCell>
                  <TableCell><Badge className={r.side === "buy" ? "bg-accent/20 text-accent border-accent/30" : "bg-primary/20 text-primary border-primary/30"}>{r.side.toUpperCase()}</Badge></TableCell>
                  <TableCell>{cpName(r.counterparty_id)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(r.delivery_start), "yyyy-MM-dd HH:mm")}<br/>→ {format(new Date(r.delivery_end), "MM-dd HH:mm")}</TableCell>
                  <TableCell className="text-xs">{r.hub ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.volume_mwh)}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.price_eur_mwh)} €</TableCell>
                  <TableCell className="text-right font-medium">{fmtEur(r.total_value_eur ?? 0)}</TableCell>
                  <TableCell>
                    <Select value={r.status} onValueChange={(v) => setStatus(r.id, v)}>
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-10">No trades match filters.</TableCell></TableRow>}
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
