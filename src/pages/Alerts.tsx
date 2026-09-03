import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { BellOff, CheckCheck, ChevronDown } from "lucide-react";

type Alert = {
  id: string; created_at: string; kind: string; severity: string;
  title: string; body: string | null; data: unknown; read_at: string | null;
};

const SEVERITIES = ["All", "info", "warning", "critical"] as const;
const LABEL: Record<string, string> = { All: "All", info: "Info", warning: "Warning", critical: "Critical" };

function severityClass(s: string) {
  if (s === "critical") return "bg-destructive/15 text-destructive border-destructive/30";
  if (s === "warning") return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
  return "bg-primary/15 text-primary border-primary/30";
}

export default function Alerts() {
  const [rows, setRows] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<string>("All");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await (supabase.from as any)("alerts")
      .select("id, created_at, kind, severity, title, body, data, read_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast({ title: "Could not load alerts", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as Alert[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const visible = useMemo(
    () => (severity === "All" ? rows : rows.filter(r => r.severity === severity)),
    [rows, severity],
  );
  const unread = rows.filter(r => !r.read_at).length;

  async function markRead(id: string) {
    const now = new Date().toISOString();
    setRows(prev => prev.map(r => (r.id === id ? { ...r, read_at: r.read_at ?? now } : r)));
    window.dispatchEvent(new Event("volttrade:alerts-changed"));
    const { error } = await (supabase.from as any)("alerts")
      .update({ read_at: now }).eq("id", id).is("read_at", null);
    if (error) toast({ title: "Could not mark as read", description: error.message, variant: "destructive" });
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setRows(prev => prev.map(r => ({ ...r, read_at: r.read_at ?? now })));
    window.dispatchEvent(new Event("volttrade:alerts-changed"));
    const { error } = await (supabase.from as any)("alerts")
      .update({ read_at: now }).is("read_at", null);
    if (error) toast({ title: "Could not mark all as read", description: error.message, variant: "destructive" });
    else load(true);
  }

  return (
    <ErpLayout
      title="Alerts"
      subtitle={unread > 0 ? `${unread} unread` : "All caught up"}
      actions={
        <Button variant="outline" size="sm" onClick={markAllRead} disabled={unread === 0}>
          <CheckCheck className="h-4 w-4 mr-2" /> Mark all as read
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1 w-fit">
        {SEVERITIES.map(s => (
          <Button
            key={s}
            size="sm"
            variant={severity === s ? "secondary" : "ghost"}
            className="h-7 px-3 text-xs"
            onClick={() => setSeverity(s)}
          >
            {LABEL[s]}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground space-y-2">
            <BellOff className="h-8 w-8 mx-auto opacity-50" />
            <p>No alerts yet — system events, retrain outcomes and arbitrage finds will show up here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map(a => {
            const isUnread = !a.read_at;
            return (
              <Card
                key={a.id}
                className={`transition-colors cursor-pointer ${isUnread ? "bg-accent/40 border-primary/30" : ""}`}
                onClick={() => isUnread && markRead(a.id)}
              >
                <CardContent className="py-3 px-4 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isUnread && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                    <Badge variant="outline" className={severityClass(a.severity)}>{a.severity}</Badge>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{a.kind}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {format(new Date(a.created_at), "dd.MM.yyyy HH:mm")}
                    </span>
                  </div>
                  <div className="font-medium">{a.title}</div>
                  {a.body && <p className="text-sm text-muted-foreground">{a.body}</p>}
                  {a.data != null && (
                    <div onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        onClick={() => setOpen(o => ({ ...o, [a.id]: !o[a.id] }))}
                      >
                        <ChevronDown className={`h-3 w-3 transition-transform ${open[a.id] ? "rotate-180" : ""}`} />
                        details
                      </button>
                      {open[a.id] && (
                        <pre className="mt-2 text-xs bg-muted/50 rounded-md p-3 overflow-auto max-h-64">
                          {JSON.stringify(a.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </ErpLayout>
  );
}
