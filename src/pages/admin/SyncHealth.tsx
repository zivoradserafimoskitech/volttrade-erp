import { useCallback, useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

type Feed = {
  key: string;
  label: string;
  description: string;
  fn?: string;
  body?: Record<string, unknown>;
  warnHours: number;
  failHours: number;
  last: string | null;
  count: number;
};

const FEED_DEFS: Omit<Feed, "last" | "count">[] = [
  { key: "market_prices", label: "Day-ahead prices", description: "market_prices — ENTSO-E / ELEX / providers", fn: "sync-entsoe-prices", body: { zone: "MK", days: 2 }, warnHours: 12, failHours: 36 },
  { key: "asset_telemetry", label: "Asset telemetry", description: "asset_telemetry — BESS / PV inverters", fn: "sync-asset-telemetry", warnHours: 2, failHours: 12 },
  { key: "consumption_readings", label: "Meter readings", description: "consumption_readings — DSO & smart meters", fn: "sync-kimi-meters", body: { window_minutes: 60, bucket_minutes: 60 }, warnHours: 6, failHours: 24 },
  { key: "forecasts", label: "Volume forecasts", description: "forecasts — internal + third-party (InfluxDB)", fn: "forecast-volumes", warnHours: 26, failHours: 72 },
];

const TS_COL: Record<string, string> = {
  market_prices: "created_at",
  asset_telemetry: "ts",
  consumption_readings: "created_at",
  forecasts: "created_at",
};

function statusOf(f: Feed) {
  if (!f.last) return "fail" as const;
  const hours = (Date.now() - new Date(f.last).getTime()) / 3_600_000;
  if (hours > f.failHours) return "fail" as const;
  if (hours > f.warnHours) return "warn" as const;
  return "ok" as const;
}

const STATUS_UI = {
  ok: { icon: CheckCircle2, cls: "text-primary", label: "Healthy" },
  warn: { icon: AlertTriangle, cls: "text-amber-500", label: "Stale" },
  fail: { icon: XCircle, cls: "text-destructive", label: "Failing" },
};

export default function SyncHealth() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
    const results = await Promise.all(
      FEED_DEFS.map(async (d) => {
        const col = TS_COL[d.key];
        const [{ data }, { count }] = await Promise.all([
          supabase.from(d.key as any).select(col).order(col, { ascending: false }).limit(1),
          supabase.from(d.key as any).select("*", { count: "exact", head: true }).gte(col, since),
        ]);
        const last = (data as any)?.[0]?.[col] ?? null;
        return { ...d, last, count: count ?? 0 } as Feed;
      })
    );
    setFeeds(results);
    const { data: logRows } = await supabase
      .from("external_api_log").select("*").order("called_at", { ascending: false }).limit(50);
    setLog(logRows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (f: Feed) => {
    if (!f.fn) return;
    setRunning(f.key);
    try {
      const { data, error } = await supabase.functions.invoke(f.fn, { body: f.body ?? {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`${f.label}: sync finished`);
      load();
    } catch (e: any) {
      toast.error(`${f.label}: ${e?.message ?? "sync failed"}`);
    } finally {
      setRunning(null);
    }
  };

  const failing = feeds.filter((f) => statusOf(f) === "fail").length;

  return (
    <ErpLayout
      title="Sync Health"
      subtitle="Freshness of every external data feed and the integration run log"
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      }
    >
      <RoleGate roles={["admin", "management", "operations"]}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {feeds.map((f) => {
            const s = statusOf(f);
            const Ui = STATUS_UI[s];
            return (
              <Card key={f.key} className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Ui.icon className={`h-4 w-4 ${Ui.cls}`} />{f.label}
                  </CardTitle>
                  <CardDescription className="text-xs">{f.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-lg font-semibold">
                    {f.last ? `${formatDistanceToNow(new Date(f.last))} ago` : "No data"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {f.count.toLocaleString()} rows in last 7 days · target &lt; {f.warnHours}h
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <Badge variant={s === "ok" ? "secondary" : s === "warn" ? "outline" : "destructive"}>{Ui.label}</Badge>
                    {f.fn && (
                      <Button size="sm" variant="ghost" onClick={() => run(f)} disabled={running === f.key}>
                        {running === f.key ? "Running…" : "Run now"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {failing > 0 && (
          <Card className="border-destructive/50">
            <CardContent className="p-4 text-sm">
              <span className="font-medium text-destructive">{failing} feed(s) beyond their failure threshold.</span>{" "}
              Check the run log below, the required integration secrets, and the scheduled jobs.
            </CardContent>
          </Card>
        )}

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Integration run log</CardTitle>
            <CardDescription>Last 50 outbound calls to external providers</CardDescription>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">No provider calls recorded yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>When</TableHead><TableHead>Provider</TableHead><TableHead>Endpoint</TableHead><TableHead className="text-right">Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {log.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{format(new Date(r.called_at), "yyyy-MM-dd HH:mm")}</TableCell>
                      <TableCell className="font-medium">{r.provider}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[420px] truncate">{r.endpoint ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.status && r.status < 400 ? "secondary" : "destructive"}>{r.status ?? "—"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </RoleGate>
    </ErpLayout>
  );
}
