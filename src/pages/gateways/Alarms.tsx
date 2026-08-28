import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/erp/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Bell, ExternalLink, Link2Off, RefreshCw } from "lucide-react";

type Alarm = {
  id: string; gateway_alarm_id: number | null; device_id: number | null; gateway_id: number | null;
  asset_id: string | null; metering_point_id: string | null;
  metric: string | null; value: number | null; threshold: number | null;
  severity: string | null; message: string | null; status: string | null;
  triggered_at: string | null; acknowledged_at: string | null; resolved_at: string | null;
};

const GATEWAY_UI = (import.meta.env.VITE_GATEWAY_UI_URL as string | undefined)?.replace(/\/$/, "");
const SEV_ORDER: Record<string, number> = { critical: 0, major: 1, warning: 2, minor: 3, info: 4 };
const PAGE = 500;

export default function GatewayAlarms() {
  const [rows, setRows] = useState<Alarm[]>([]);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [points, setPoints] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const all: Alarm[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = (supabase.from as any)("gateway_alarms")
        .select("*")
        .order("triggered_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) break;
      const batch = (data ?? []) as Alarm[];
      all.push(...batch);
      if (batch.length < PAGE || all.length >= 5000) break;
    }
    setRows(all);

    const [{ data: a }, { data: mp }] = await Promise.all([
      supabase.from("assets").select("id, asset_code"),
      supabase.from("metering_points").select("id, edu_code"),
    ]);
    setAssets(Object.fromEntries(((a ?? []) as any[]).map(r => [r.id, r.asset_code])));
    setPoints(Object.fromEntries(((mp ?? []) as any[]).map(r => [r.id, r.edu_code])));
    setLoading(false);
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => [...rows].sort((x, y) => {
    const s = (SEV_ORDER[(x.severity ?? "").toLowerCase()] ?? 9) - (SEV_ORDER[(y.severity ?? "").toLowerCase()] ?? 9);
    if (s !== 0) return s;
    return new Date(y.triggered_at ?? 0).getTime() - new Date(x.triggered_at ?? 0).getTime();
  }), [rows]);

  const stats = useMemo(() => {
    const active = rows.filter(r => r.status === "active");
    return {
      active: active.length,
      critical: active.filter(r => (r.severity ?? "").toLowerCase() === "critical").length,
      unlinked: active.filter(r => !r.asset_id && !r.metering_point_id).length,
    };
  }, [rows]);

  const device = (r: Alarm) => {
    if (r.asset_id && assets[r.asset_id]) return assets[r.asset_id];
    if (r.metering_point_id && points[r.metering_point_id]) return points[r.metering_point_id];
    return `Unlinked device #${r.device_id ?? "?"}`;
  };

  const sevVariant = (s: string | null) => {
    const v = (s ?? "").toLowerCase();
    if (v === "critical") return "destructive" as const;
    return "secondary" as const;
  };

  return (
    <ErpLayout
      title="Gateway Alarms"
      subtitle="Live mirror of alarms raised by the gateway platform"
      actions={
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Active alarms" value={String(stats.active)} icon={Bell} />
        <StatCard label="Critical" value={String(stats.critical)} icon={AlertTriangle} />
        <StatCard label="Not linked to an asset or meter" value={String(stats.unlinked)} icon={Link2Off} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Alarms</CardTitle>
          <CardDescription>
            This list is read-only. Acknowledging and resolving happens in the gateway platform, where the operator sees the
            plant state — two systems owning the same alarm state would mean an alarm cleared in one place and still ringing in
            the other.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Severity</TableHead><TableHead>When</TableHead><TableHead>Device</TableHead>
              <TableHead>Metric</TableHead><TableHead>Message</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {sorted.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge
                      variant={sevVariant(r.severity)}
                      className={(r.severity ?? "").toLowerCase() === "warning" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : ""}
                    >
                      {r.severity ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.triggered_at ? `${formatDistanceToNow(new Date(r.triggered_at))} ago` : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{device(r)}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-medium">{r.metric ?? "—"}</span>
                    {r.value !== null && <span className="text-muted-foreground"> · {r.value}{r.threshold !== null ? ` / ${r.threshold}` : ""}</span>}
                  </TableCell>
                  <TableCell className="text-sm max-w-sm truncate">{r.message ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.status ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {GATEWAY_UI && r.device_id !== null ? (
                      <a
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        href={`${GATEWAY_UI}/devices/${r.device_id}`}
                        target="_blank" rel="noopener noreferrer"
                      >
                        Open in gateway <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Handle in gateway</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && sorted.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">No alarms for this filter.</TableCell></TableRow>
              )}
              {loading && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">Loading…</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}
