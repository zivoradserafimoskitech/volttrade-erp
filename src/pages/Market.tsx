import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { format } from "date-fns";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";
import { Plus, RefreshCw, HelpCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SelectGroup, SelectLabel } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Price = { id: string; delivery_at: string; price_eur_mwh: number };

// A single flat list of price sources so there is only one thing to choose.
const SOURCES = [
  { value: "entsoe:HU", group: "ENTSO-E Transparency", label: "Hungary — HUPX / MAVIR" },
  { value: "entsoe:MK", group: "ENTSO-E Transparency", label: "North Macedonia — MEPSO" },
  { value: "entsoe:RS", group: "ENTSO-E Transparency", label: "Serbia" },
  { value: "entsoe:BG", group: "ENTSO-E Transparency", label: "Bulgaria" },
  { value: "entsoe:GR", group: "ENTSO-E Transparency", label: "Greece" },
  { value: "entsoe:RO", group: "ENTSO-E Transparency", label: "Romania" },
  { value: "entsoe:HR", group: "ENTSO-E Transparency", label: "Croatia" },
  { value: "entsoe:SI", group: "ENTSO-E Transparency", label: "Slovenia" },
  { value: "entsoe:AT", group: "ENTSO-E Transparency", label: "Austria — APG" },
  { value: "entsoe:DE_LU", group: "ENTSO-E Transparency", label: "Germany / Luxembourg" },
  { value: "elex", group: "Exchanges & providers", label: "ELEX — MK day-ahead exchange" },
  { value: "provider:elecz:MK", group: "Exchanges & providers", label: "Elecz — North Macedonia" },
  { value: "provider:elecz:RS", group: "Exchanges & providers", label: "Elecz — Serbia" },
  { value: "provider:elecz:HU", group: "Exchanges & providers", label: "Elecz — Hungary" },
  { value: "provider:elecz:GR", group: "Exchanges & providers", label: "Elecz — Greece" },
  { value: "provider:elecz:RO", group: "Exchanges & providers", label: "Elecz — Romania" },
  { value: "provider:elecz:BA", group: "Exchanges & providers", label: "Elecz — Bosnia & Herzegovina" },
  { value: "provider:elecz:ME", group: "Exchanges & providers", label: "Elecz — Montenegro" },
  { value: "provider:stekker", group: "Exchanges & providers", label: "Stekker" },
  { value: "provider:eex", group: "Exchanges & providers", label: "EEX" },
];

export default function Market() {
  const [prices, setPrices] = useState<Price[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [zone, setZone] = useState("HU");
  const load = async () => {
    const { data } = await supabase.from("market_prices").select("*").order("delivery_at", { ascending: false }).limit(168);
    setPrices(((data as any) ?? []).reverse());
  };
  useEffect(() => { load(); }, []);

  const syncEntsoeZone = async (z: string) => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-entsoe-prices", { body: { zone: z, days: 2 } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Synced ${(data as any)?.inserted ?? 0} prices from ENTSO-E (${z})`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const [elexSyncing, setElexSyncing] = useState(false);
  const [provSyncing, setProvSyncing] = useState(false);
  const syncProviderNamed = async (provider: string) => {
    setProvSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-price-providers", { body: { provider, zone: "MK" } });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "Sync failed");
      toast.success(`${provider.toUpperCase()}: ${(data as any).rows} prices · ${(data as any).calls_used_today}/${(data as any).cap} calls today`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? `${provider} sync failed`);
    } finally {
      setProvSyncing(false);
    }
  };
  const syncElex = async (probe = false) => {
    setElexSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-elex-prices", { body: probe ? { probe: true } : {} });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "ELEX sync failed");
      if (probe) {
        console.log("ELEX API discovery:", (data as any).findings);
        toast.success(`ELEX probe done — ${(data as any).findings?.length ?? 0} endpoints tried (details in console). ${(data as any).calls_used_today}/${(data as any).cap} calls today.`);
      } else {
        toast.success(`ELEX: ${(data as any).rows} prices for ${(data as any).date} · ${(data as any).calls_used_today}/${(data as any).cap} calls today`);
        load();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "ELEX sync failed");
    } finally {
      setElexSyncing(false);
    }
  };

  const [source, setSource] = useState("entsoe:HU");
  const busy = syncing || elexSyncing || provSyncing;
  const runSync = async () => {
    if (source.startsWith("entsoe:")) { setZone(source.slice(7)); await syncEntsoeZone(source.slice(7)); }
    else if (source === "elex") await syncElex(false);
    else await syncProviderNamed(source.slice(9));
  };

  const add = async (form: FormData) => {
    const dt = String(form.get("delivery_at"));
    const price = Number(form.get("price"));
    const { error } = await supabase.from("market_prices").insert({ delivery_at: new Date(dt).toISOString(), price_eur_mwh: price });
    if (error) return toast.error(error.message);
    toast.success("Price added"); load();
  };

  const chartData = prices.map(p => ({ time: format(new Date(p.delivery_at), "MM-dd HH:mm"), price: Number(p.price_eur_mwh) }));
  const min = Math.min(...chartData.map(d => d.price), Infinity);
  const max = Math.max(...chartData.map(d => d.price), -Infinity);
  const avg = chartData.length ? chartData.reduce((s,d)=>s+d.price,0)/chartData.length : 0;

  const latestTs = prices.length ? new Date(prices[prices.length - 1].delivery_at) : null;
  const ageHours = latestTs ? (Date.now() - latestTs.getTime()) / 3_600_000 : null;
  const stale = ageHours === null || ageHours > 24;

  return (
    <ErpLayout
      title="Market Prices"
      subtitle="Hourly day-ahead prices (€/MWh) — ENTSO-E Transparency"
      actions={
        <div className="flex items-center gap-2">
          <div className="hidden sm:block text-xs text-muted-foreground">Price source</div>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-[230px]"><SelectValue placeholder="Choose a price source" /></SelectTrigger>
            <SelectContent>
              {["ENTSO-E Transparency", "Exchanges & providers"].map(group => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {SOURCES.filter(s => s.group === group).map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={runSync} disabled={busy} style={{ background: "var(--gradient-primary)" }}>
            <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Fetching…" : "Fetch prices"}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="What does this do?"><HelpCircle className="h-4 w-4" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 text-sm space-y-3">
              <div>
                <p className="font-medium">Fetching day-ahead prices</p>
                <p className="text-muted-foreground mt-1">
                  Pick where the hourly €/MWh prices should come from, then press <span className="font-medium text-foreground">Fetch prices</span>.
                  New hours are added and existing hours are updated — nothing is duplicated.
                </p>
              </div>
              <ul className="text-muted-foreground space-y-1">
                <li><span className="text-foreground">ENTSO-E</span> — official European transparency platform, one bidding zone at a time.</li>
                <li><span className="text-foreground">ELEX / providers</span> — regional exchanges and commercial feeds (daily call limits apply).</li>
              </ul>
              <Button variant="outline" size="sm" className="w-full" disabled={elexSyncing} onClick={() => syncElex(true)}>
                Test ELEX connection (no data written)
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      }
    >
      {stale && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium">Price data is not up to date</p>
          <p className="text-muted-foreground mt-1">
            {latestTs
              ? <>The newest hour stored is <span className="text-foreground">{format(latestTs, "d MMM yyyy HH:mm")}</span> ({Math.round(ageHours!/24)} days old).</>
              : <>No market prices have been stored yet.</>}
            {" "}Automatic fetching is switched off because no market-data credentials are saved for this workspace —
            ENTSO-E needs a free API token, and the ELEX/Elecz/EEX feeds need their own keys. Until one is added,
            every fetch returns “not configured”.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Records" value={String(chartData.length)} />
        <Stat label="Min" value={isFinite(min) ? `${fmtNum(min)} €` : "—"} />
        <Stat label="Avg" value={`${fmtNum(avg)} €`} accent />
        <Stat label="Max" value={isFinite(max) ? `${fmtNum(max)} €` : "—"} />
      </div>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Hourly trend</CardTitle><CardDescription>Last {chartData.length} hours</CardDescription></CardHeader>
        <CardContent className="h-80">
          {chartData.length === 0 ? <div className="h-full grid place-items-center text-sm text-muted-foreground">No prices yet.</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader><CardTitle>Distribution</CardTitle></CardHeader>
          <CardContent className="h-72">
            {chartData.length === 0 ? null : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.slice(-48)}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} hide />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="price" fill="hsl(var(--accent))" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader><CardTitle>Add price</CardTitle><CardDescription>Manual entry (MTU)</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget)); (e.target as HTMLFormElement).reset(); }} className="space-y-3">
              <div className="space-y-2"><Label htmlFor="delivery_at">Delivery hour</Label><Input id="delivery_at" name="delivery_at" type="datetime-local" required /></div>
              <div className="space-y-2"><Label htmlFor="price">Price (€/MWh)</Label><Input id="price" name="price" type="number" step="0.01" required /></div>
              <Button type="submit" className="w-full"><Plus className="h-4 w-4 mr-2" />Add</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </ErpLayout>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold mt-1 ${accent ? "text-primary" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}