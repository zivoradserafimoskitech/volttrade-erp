import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/erp/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Star, ArrowLeftRight, TrendingUp, Sigma } from "lucide-react";

type Opp = {
  target_date: string; buy_zone: string; sell_zone: string; hour: number;
  buy_price: number; sell_price: number; spread_eur_mwh: number; detected_at: string;
};

const n2 = (v: number) => v.toFixed(2);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function Arbitrage() {
  const [rows, setRows] = useState<Opp[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string>("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await (supabase.from as any)("arbitrage_opportunities")
      .select("target_date, buy_zone, sell_zone, hour, buy_price, sell_price, spread_eur_mwh, detected_at")
      .order("target_date", { ascending: false })
      .order("hour", { ascending: true })
      .limit(500);
    if (error) toast({ title: "Could not load opportunities", description: error.message, variant: "destructive" });
    else setRows((data ?? []) as Opp[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 300_000);
    return () => clearInterval(id);
  }, [load]);

  const dates = useMemo(
    () => Array.from(new Set(rows.map(r => r.target_date))).sort().reverse(),
    [rows],
  );
  useEffect(() => {
    if (dates.length && !dates.includes(date)) setDate(dates[0]);
  }, [dates, date]);

  const dayRows = useMemo(() => rows.filter(r => r.target_date === date), [rows, date]);
  const best = useMemo(
    () => (dayRows.length ? Math.max(...dayRows.map(r => r.spread_eur_mwh)) : 0),
    [dayRows],
  );
  const bestRow = dayRows.find(r => r.spread_eur_mwh === best);
  const avg = dayRows.length ? dayRows.reduce((s, r) => s + r.spread_eur_mwh, 0) / dayRows.length : 0;

  const pairs = useMemo(() => {
    const m = new Map<string, Opp[]>();
    for (const r of dayRows) {
      const key = `${r.buy_zone} → ${r.sell_zone}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries()).map(([k, v]) => [k, [...v].sort((a, b) => a.hour - b.hour)] as const);
  }, [dayRows]);

  return (
    <ErpLayout
      title="Cross-border arbitrage"
      subtitle="Profitable zone pairs found by the daily scan (spread ≥ 10 EUR/MWh)"
      actions={
        dates.length > 0 && (
          <Select value={date} onValueChange={setDate}>
            <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dates.map(d => (
                <SelectItem key={d} value={d}>{format(new Date(d), "dd.MM.yyyy")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : dayRows.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            No arbitrage opportunities for this date — spreads stayed below the threshold.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Opportunities" value={String(dayRows.length)} icon={ArrowLeftRight} />
            <StatCard
              label="Best spread"
              value={`${n2(best)} EUR/MWh`}
              icon={TrendingUp}
              hint={bestRow ? `${bestRow.buy_zone} → ${bestRow.sell_zone} ${hh(bestRow.hour)}` : undefined}
            />
            <StatCard label="Average spread" value={`${n2(avg)} EUR/MWh`} icon={Sigma} />
          </div>

          {pairs.map(([pair, list]) => (
            <Card key={pair}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{pair}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hour</TableHead>
                      <TableHead className="text-right">Buy ({list[0].buy_zone})</TableHead>
                      <TableHead className="text-right">Sell ({list[0].sell_zone})</TableHead>
                      <TableHead className="text-right">Spread</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map(r => {
                      const isBest = r.spread_eur_mwh === best;
                      return (
                        <TableRow key={`${r.hour}`} className={isBest ? "ring-1 ring-primary/50 bg-primary/5" : ""}>
                          <TableCell className="font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              {isBest && <Star className="h-3.5 w-3.5 text-primary fill-primary" />}
                              {hh(r.hour)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{n2(r.buy_price)}</TableCell>
                          <TableCell className="text-right tabular-nums">{n2(r.sell_price)}</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={`tabular-nums ${r.spread_eur_mwh >= 25
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                : ""}`}
                            >
                              {n2(r.spread_eur_mwh)} EUR/MWh{isBest ? " · BEST" : ""}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </ErpLayout>
  );
}
