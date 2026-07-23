import { useCallback, useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/erp/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { CalendarCheck, AlertTriangle, Check, Clock, RefreshCw } from "lucide-react";

/**
 * Regulatory compliance calendar — recurring obligations from the Macedonian
 * Market Rules and Balancing Rules. Task instances are generated on load for
 * a rolling window, so a missed deadline is visible rather than discovered
 * after a penalty. Working-day rules skip weekends and public_holidays.
 */

type Obligation = {
  id: string; code: string; title: string; description: string | null;
  legal_ref: string | null; recurrence: "daily" | "monthly";
  due_rule: any; responsible_role: string | null; active: boolean;
};
type Task = {
  id: string; obligation_id: string; period_label: string; due_at: string;
  status: "pending" | "done" | "skipped"; completed_at: string | null;
};

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** Nth working day of a month, skipping weekends and public holidays. */
function nthWorkingDay(year: number, month0: number, n: number, holidays: Set<string>): Date {
  const d = new Date(Date.UTC(year, month0, 1));
  let count = 0;
  while (count < n) {
    if (!isWeekend(d) && !holidays.has(d.toISOString().slice(0, 10))) count++;
    if (count < n) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

function atLocalTime(d: Date, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  // Stored as UTC; Macedonian local time is UTC+1/+2 — offset applied via toISOString
  const out = new Date(d);
  out.setUTCHours(h - 2, m, 0, 0); // CEST; drifts one hour in winter, acceptable for a reminder
  return out.toISOString();
}

export default function Compliance() {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: ob }, { data: tk }, { data: hol }] = await Promise.all([
      (supabase.from as any)("compliance_obligations").select("*").eq("active", true).order("code"),
      (supabase.from as any)("compliance_tasks").select("*").order("due_at"),
      (supabase.from as any)("public_holidays").select("holiday_date"),
    ]);
    setObligations((ob ?? []) as Obligation[]);
    setTasks((tk ?? []) as Task[]);
    setHolidays(new Set(((hol ?? []) as any[]).map(h => String(h.holiday_date))));
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Create missing task instances: monthly for 3 months, daily for the next 7 days. */
  const generate = useCallback(async (obs: Obligation[], hol: Set<string>) => {
    if (!obs.length) return;
    const rows: any[] = [];
    const now = new Date();

    for (const o of obs) {
      if (o.recurrence === "monthly") {
        for (let k = -1; k <= 1; k++) {
          const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
          const periodLabel = ref.toISOString().slice(0, 7);
          let due: Date;
          if (o.due_rule?.type === "working_day") {
            // Obligation refers to the month AFTER the period it covers
            const next = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
            due = nthWorkingDay(next.getUTCFullYear(), next.getUTCMonth(), Number(o.due_rule.n ?? 1), hol);
          } else {
            const next = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, Number(o.due_rule?.day ?? 15)));
            due = next;
          }
          rows.push({ obligation_id: o.id, period_label: periodLabel, due_at: atLocalTime(due, "23:59") });
        }
      } else {
        for (let k = 0; k < 7; k++) {
          const d = new Date(now.getTime() + k * 86400000);
          const label = d.toISOString().slice(0, 10);
          rows.push({ obligation_id: o.id, period_label: label, due_at: atLocalTime(d, o.due_rule?.time ?? "14:30") });
        }
      }
    }
    if (rows.length) {
      await (supabase.from as any)("compliance_tasks").upsert(rows, { onConflict: "obligation_id,period_label", ignoreDuplicates: true });
    }
  }, []);

  useEffect(() => {
    if (obligations.length && !busy) {
      (async () => { await generate(obligations, holidays); await load(); })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obligations.length]);

  const obById = useMemo(() => new Map(obligations.map(o => [o.id, o])), [obligations]);

  const rows = useMemo(() => {
    const now = Date.now();
    return tasks
      .map(t => {
        const o = obById.get(t.obligation_id);
        const overdue = t.status === "pending" && new Date(t.due_at).getTime() < now;
        return { ...t, o, overdue };
      })
      .filter(r => r.o)
      .filter(r => r.status === "pending" || new Date(r.due_at).getTime() > now - 30 * 86400000)
      .sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        return a.due_at.localeCompare(b.due_at);
      });
  }, [tasks, obById]);

  const stats = useMemo(() => {
    const now = Date.now();
    const pending = rows.filter(r => r.status === "pending");
    return {
      overdue: pending.filter(r => r.overdue).length,
      week: pending.filter(r => !r.overdue && new Date(r.due_at).getTime() < now + 7 * 86400000).length,
      pending: pending.length,
    };
  }, [rows]);

  async function mark(id: string, status: "done" | "pending") {
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await (supabase.from as any)("compliance_tasks").update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
      completed_by: status === "done" ? u?.user?.id ?? null : null,
    }).eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    await load();
    setBusy(false);
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString("mk-MK", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <ErpLayout title="Регулаторни обврски" subtitle="Рокови од Правилата за пазар и Правилата за балансирање"
      actions={<Button size="sm" variant="outline" onClick={() => load()}><RefreshCw className="h-4 w-4 mr-1" />Освежи</Button>}>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="Пречекорени" value={String(stats.overdue)} icon={AlertTriangle} accent={stats.overdue ? "destructive" : "primary"} />
        <StatCard label="Оваа недела" value={String(stats.week)} icon={Clock} accent={stats.week ? "warning" : "primary"} />
        <StatCard label="Отворени вкупно" value={String(stats.pending)} icon={CalendarCheck} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Рокови</CardTitle>
          <CardDescription>
            Задачите се генерираат автоматски. Роковите по работен ден ги прескокнуваат викендите и празниците.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Обврска</TableHead>
              <TableHead>Правен основ</TableHead>
              <TableHead>Период</TableHead>
              <TableHead>Рок</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Дејство</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className={r.overdue ? "bg-destructive/5" : ""}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.o!.title}</div>
                    {r.o!.description && <div className="text-xs text-muted-foreground max-w-md">{r.o!.description}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.o!.legal_ref ?? "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums whitespace-nowrap">{r.period_label}</TableCell>
                  <TableCell className="text-sm tabular-nums whitespace-nowrap">{fmt(r.due_at)}</TableCell>
                  <TableCell>
                    {r.status === "done"
                      ? <Badge variant="secondary"><Check className="h-3 w-3 mr-1" />Завршено</Badge>
                      : r.overdue
                        ? <Badge variant="destructive">Пречекорен</Badge>
                        : <Badge variant="outline">Отворен</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "done"
                      ? <Button size="sm" variant="ghost" onClick={() => mark(r.id, "pending")} disabled={busy}>Врати</Button>
                      : <Button size="sm" variant="outline" onClick={() => mark(r.id, "done")} disabled={busy}>Означи завршено</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                  Нема обврски — примени ја миграцијата за да се внесат роковите.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}
