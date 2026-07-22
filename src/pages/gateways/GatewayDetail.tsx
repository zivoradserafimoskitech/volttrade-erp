import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/erp/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, ArrowLeft, Radio, Zap, Gauge, TrendingUp } from "lucide-react";
import { formatDistanceToNow, subHours } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

type MP = { id: string; edu_code: string; kimi_meter_id: number | null; category: string | null; site_name: string | null; address: string | null };
type Reading = { reading_at: string; import_kwh: number; export_kwh: number };
type Cumulative = { reading_at: string; import_kwh: number; export_kwh: number };

const WIN: Record<string, number> = { "6h": 6, "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };

export default function GatewayDetail() {
  const { id } = useParams<{ id: string }>();
  const [mp, setMp] = useState<MP | null>(null);
  const [series, setSeries] = useState<Reading[]>([]);
  const [latestCum, setLatestCum] = useState<Cumulative | null>(null);
  const [win, setWin] = useState<string>("24h");
  const [live, setLive] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    if (!id) return;
    const { data: mpRow } = await supabase.from("metering_points").select("id, edu_code, kimi_meter_id, metering_category, address").eq("id", id).maybeSingle();
    setMp(mpRow ? ({
      id: (mpRow as any).id,
      edu_code: (mpRow as any).edu_code,
      kimi_meter_id: (mpRow as any).kimi_meter_id,
      category: (mpRow as any).metering_category ?? null,
      site_name: (mpRow as any).address ?? null,
      address: (mpRow as any).address ?? null,
    } as MP) : null);
    const from = subHours(new Date(), WIN[win]).toISOString();
    const [r, c] = await Promise.all([
      supabase.from("consumption_readings").select("reading_at, import_kwh, export_kwh").eq("metering_point_id", id).gte("reading_at", from).order("reading_at"),
      supabase.from("meter_readings").select("reading_at, import_kwh, export_kwh").eq("metering_point_id", id).order("reading_at", { ascending: false }).limit(1),
    ]);
    setSeries((r.data ?? []) as any);
    setLatestCum(((c.data ?? [])[0] as any) ?? null);
  }

  useEffect(() => { load(); }, [id, win]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [live, id, win]);

  const stats = useMemo(() => {
    const imp = series.reduce((s, r) => s + Number(r.import_kwh || 0), 0);
    const exp = series.reduce((s, r) => s + Number(r.export_kwh || 0), 0);
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    const instant = last && prev ? (Number(last.import_kwh) * (60 / 15)) : 0; // 15-min bucket → kW-avg
    return { imp, exp, instant, last: last?.reading_at };
  }, [series]);

  async function runSync() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-kimi-meters", { body: { window_minutes: 240, bucket_minutes: 15 } });
      if (error) throw error;
      toast.success(`Synced ${data?.intervals_synced ?? 0} intervals`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <ErpLayout
      title={mp ? `Gateway · ${mp.edu_code}` : "Gateway"}
      subtitle={mp ? `Kimi meter #${mp.kimi_meter_id} · ${mp.site_name ?? mp.address ?? ""}` : ""}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Label htmlFor="live" className="text-xs">Live</Label>
            <Switch id="live" checked={live} onCheckedChange={setLive} />
          </div>
          <Select value={win} onValueChange={setWin}>
            <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.keys(WIN).map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={runSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} /> Sync
          </Button>
          <Button asChild size="sm" variant="ghost"><Link to="/gateways"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link></Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Instant load" value={`${stats.instant.toFixed(2)} kW`} icon={Zap} accent="primary" />
        <StatCard label={`Import (${win})`} value={`${stats.imp.toFixed(1)} kWh`} icon={TrendingUp} />
        <StatCard label={`Export (${win})`} value={`${stats.exp.toFixed(1)} kWh`} icon={Gauge} accent="accent" />
        <StatCard label="Last reading" value={stats.last ? formatDistanceToNow(new Date(stats.last), { addSuffix: true }) : "—"} icon={Radio} hint={live ? "Auto-refresh 10s" : "Manual"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Interval consumption</CardTitle></CardHeader>
        <CardContent>
          {series.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No interval data in the selected window.</div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="imp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient>
                    <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.5} /><stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="reading_at" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(v) => new Date(v as string).toLocaleString()} />
                  <Legend />
                  <Area type="monotone" dataKey="import_kwh" name="Import kWh" stroke="hsl(var(--primary))" fill="url(#imp)" />
                  <Area type="monotone" dataKey="export_kwh" name="Export kWh" stroke="hsl(var(--accent))" fill="url(#exp)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {latestCum && (
        <Card>
          <CardHeader><CardTitle className="text-base">Cumulative registers (settlement-grade)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div><div className="text-muted-foreground text-xs">Last read</div><div className="font-mono">{new Date(latestCum.reading_at).toLocaleString()}</div></div>
            <div><div className="text-muted-foreground text-xs">Import register</div><div className="font-mono">{Number(latestCum.import_kwh).toLocaleString()} kWh</div></div>
            <div><div className="text-muted-foreground text-xs">Export register</div><div className="font-mono">{Number(latestCum.export_kwh).toLocaleString()} kWh</div></div>
          </CardContent>
        </Card>
      )}
    </ErpLayout>
  );
}