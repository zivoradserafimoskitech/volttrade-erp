import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/erp/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Radio, ExternalLink, Activity, Wifi, WifiOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type MP = { id: string; edu_code: string; kimi_meter_id: number | null; category: string | null; site_name: string | null };
type Latest = { metering_point_id: string; reading_at: string; import_kwh: number; export_kwh: number };

export default function Gateways() {
  const [mps, setMps] = useState<MP[]>([]);
  const [latestMap, setLatestMap] = useState<Record<string, Latest>>({});
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: mpRows } = await supabase
      .from("metering_points")
      .select("id, edu_code, kimi_meter_id, category, site_name")
      .not("kimi_meter_id", "is", null)
      .order("edu_code");
    const list = (mpRows ?? []) as any as MP[];
    setMps(list);

    if (list.length > 0) {
      const { data: reads } = await supabase
        .from("consumption_readings")
        .select("metering_point_id, reading_at, import_kwh, export_kwh")
        .in("metering_point_id", list.map(m => m.id))
        .order("reading_at", { ascending: false })
        .limit(1000);
      const map: Record<string, Latest> = {};
      (reads ?? []).forEach((r: any) => { if (!map[r.metering_point_id]) map[r.metering_point_id] = r; });
      setLatestMap(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? mps.filter(m => (m.edu_code || "").toLowerCase().includes(s) || String(m.kimi_meter_id ?? "").includes(s)) : mps;
  }, [mps, q]);

  const stats = useMemo(() => {
    const now = Date.now();
    let online = 0, stale = 0;
    mps.forEach(m => {
      const l = latestMap[m.id];
      if (!l) { stale++; return; }
      const age = (now - new Date(l.reading_at).getTime()) / 60000;
      if (age < 15) online++; else stale++;
    });
    return { total: mps.length, online, stale };
  }, [mps, latestMap]);

  async function runSync() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-kimi-meters", {
        body: { window_minutes: 120, bucket_minutes: 15 },
      });
      if (error) throw error;
      toast.success(`Synced ${data?.readings_synced ?? 0} reads · ${data?.intervals_synced ?? 0} intervals`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Sync failed. Ensure TIMESCALE_URL is configured.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <ErpLayout
      title="Gateway Monitoring"
      subtitle="Kimi / Enertrek smart-meter gateways linked to your supply points"
      actions={
        <Button size="sm" onClick={runSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} /> Sync now
        </Button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Linked meters" value={stats.total} icon={Radio} />
        <StatCard title="Online (< 15 min)" value={stats.online} icon={Wifi} />
        <StatCard title="Stale / offline" value={stats.stale} icon={WifiOff} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Gateways</CardTitle>
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search EDU or meter id…" className="max-w-xs" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No metering points linked to a Kimi meter yet. Set <code>kimi_meter_id</code> on a metering point to enable sync.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EDU / POD</TableHead>
                  <TableHead>Kimi meter</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Last reading</TableHead>
                  <TableHead className="text-right">Last kWh</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(m => {
                  const l = latestMap[m.id];
                  const ageMin = l ? (Date.now() - new Date(l.reading_at).getTime()) / 60000 : Infinity;
                  const online = ageMin < 15;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.edu_code}</TableCell>
                      <TableCell className="font-mono text-xs">{m.kimi_meter_id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.site_name ?? "—"}</TableCell>
                      <TableCell>{m.category ? <Badge variant="outline">{m.category}</Badge> : "—"}</TableCell>
                      <TableCell className="text-sm">{l ? formatDistanceToNow(new Date(l.reading_at), { addSuffix: true }) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{l ? l.import_kwh.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</TableCell>
                      <TableCell>
                        {online ? <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30"><Activity className="h-3 w-3 mr-1" />Online</Badge>
                                : <Badge variant="outline" className="text-muted-foreground">Stale</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/gateways/${m.id}`}><ExternalLink className="h-4 w-4" /></Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ErpLayout>
  );
}