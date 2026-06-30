import { useEffect, useMemo, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Sparkles, Clock, TrendingDown, CheckCircle2, Flame, Trophy } from "lucide-react";
import { fmtNum } from "@/lib/format";

const EMBER = "#FF6B2C";

export default function PortalSavings() {
  const { user } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [signups, setSignups] = useState<any[]>([]);

  const load = async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    setClientId(cl.id);
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    const [{ data: ss }, { data: sg }] = await Promise.all([
      supabase.from("saving_sessions").select("*").gte("window_end", since).order("window_start", { ascending: true }),
      supabase.from("saving_session_signups").select("*").eq("client_id", cl.id),
    ]);
    setSessions(ss ?? []);
    setSignups(sg ?? []);
  };
  useEffect(() => { load(); }, [user]);

  // Seed a couple of upcoming sessions on first visit if the table is empty
  useEffect(() => { (async () => {
    if (!clientId) return;
    if (sessions.length > 0) return;
    const now = new Date();
    const ev = new Date(now); ev.setHours(18, 0, 0, 0); if (ev <= now) ev.setDate(ev.getDate() + 1);
    const evEnd = new Date(ev.getTime() + 90 * 60_000);
    const next = new Date(ev.getTime() + 2 * 86400e3);
    const nextEnd = new Date(next.getTime() + 60 * 60_000);
    await supabase.from("saving_sessions").insert([
      { title: "Evening peak — reduce your usage", description: "Help shave the evening peak and earn 4 cents per kWh saved.", window_start: ev.toISOString(), window_end: evEnd.toISOString(), points_per_kwh: 4000, eur_per_point: 0.001, status: "scheduled" },
      { title: "Free electricity hour", description: "Use as much as you like, on us, between the window times.", window_start: next.toISOString(), window_end: nextEnd.toISOString(), points_per_kwh: 0, eur_per_point: 0.001, status: "scheduled" },
    ] as any);
    load();
  })(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId, sessions.length]);

  const totals = useMemo(() => ({
    points: signups.reduce((s, x) => s + (x.points_awarded || 0), 0),
    eur: signups.reduce((s, x) => s + Number(x.credit_eur || 0), 0),
    kwhSaved: signups.reduce((s, x) => s + Number(x.saved_kwh || 0), 0),
  }), [signups]);

  const optIn = async (sessionId: string) => {
    if (!clientId) return;
    const { error } = await supabase.from("saving_session_signups").insert({
      session_id: sessionId, client_id: clientId, status: "opted_in",
    } as any);
    if (error) return toast.error(error.message);
    toast.success("You're in! We'll measure your usage during the window.");
    load();
  };

  const optOut = async (signupId: string) => {
    const { error } = await supabase.from("saving_session_signups").delete().eq("id", signupId);
    if (error) return toast.error(error.message);
    toast.success("Opted out");
    load();
  };

  const now = Date.now();
  const liveSession = sessions.find(s => new Date(s.window_start).getTime() <= now && new Date(s.window_end).getTime() >= now);
  const upcoming = sessions.filter(s => new Date(s.window_start).getTime() > now);
  const past = signups.filter(s => s.actual_kwh != null);

  const signupFor = (sid: string) => signups.find(s => s.session_id === sid);

  return (
    <PortalLayout title="Saving Sessions">
      {/* Header KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi icon={Trophy} label="Total points" value={fmtNum(totals.points)} />
        <Kpi icon={Flame} label="Credit earned" value={`€${fmtNum(totals.eur)}`} />
        <Kpi icon={TrendingDown} label="Energy saved" value={`${fmtNum(totals.kwhSaved)} kWh`} />
      </div>

      {liveSession && (
        <Card style={{ background: "linear-gradient(135deg, rgba(255,107,44,0.18), rgba(255,107,44,0.04))", borderColor: `${EMBER}55` }}>
          <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: EMBER }}></span><span className="relative inline-flex rounded-full h-3 w-3" style={{ background: EMBER }}></span></span>
              <div>
                <div className="text-xs uppercase tracking-widest" style={{ color: EMBER }}>Live session</div>
                <div className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{liveSession.title}</div>
                <div className="text-xs text-muted-foreground">Ends at {new Date(liveSession.window_end).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            </div>
            {signupFor(liveSession.id) ? <Badge style={{ background: EMBER, color: "#1A140F" }}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> You're saving now</Badge>
              : <Button onClick={() => optIn(liveSession.id)} style={{ background: EMBER, color: "#1A140F" }}>Join now</Button>}
          </CardContent>
        </Card>
      )}

      {/* Upcoming */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" style={{ color: EMBER }} /> Upcoming sessions</CardTitle></CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No upcoming sessions — check back soon.</div>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map(s => {
                const su = signupFor(s.id);
                return (
                  <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{s.title}</div>
                      <div className="text-xs text-muted-foreground">{s.description}</div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        {new Date(s.window_start).toLocaleString(undefined, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {new Date(s.window_end).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{s.points_per_kwh > 0 ? `${s.points_per_kwh} pts/kWh` : "Free hour"}</Badge>
                      {su ? (
                        <Button variant="outline" size="sm" onClick={() => optOut(su.id)}>Opt out</Button>
                      ) : (
                        <Button size="sm" style={{ background: EMBER, color: "#1A140F" }} onClick={() => optIn(s.id)}>Opt in</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Your history</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Session</TableHead><TableHead className="text-right">Baseline</TableHead><TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Saved</TableHead><TableHead className="text-right">Points</TableHead><TableHead className="text-right">Credit</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {past.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">No completed sessions yet.</TableCell></TableRow>
              ) : past.map(p => {
                const s = sessions.find(x => x.id === p.session_id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">{s?.title ?? "—"}<div className="text-[10px] text-muted-foreground">{s ? new Date(s.window_start).toLocaleDateString() : ""}</div></TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(p.baseline_kwh ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(p.actual_kwh ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums" style={{ color: EMBER }}>{fmtNum(p.saved_kwh ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.points_awarded ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">€{fmtNum(p.credit_eur ?? 0)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PortalLayout>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="h-7 w-7 rounded-md grid place-items-center" style={{ background: "rgba(255,107,44,0.12)", color: EMBER }}><Icon className="h-3.5 w-3.5" /></div>
      </div>
      <div className="text-2xl font-semibold mt-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{value}</div>
    </CardContent></Card>
  );
}