import { useEffect, useMemo, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtNum } from "@/lib/format";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, LineChart, Line,
} from "recharts";
import {
  Zap, Receipt, Leaf, TrendingDown, TrendingUp, Flame, Sun, Gauge, ArrowRight,
  MapPin, Handshake,
} from "lucide-react";

const EMBER = "#FF6B2C";
const EMBER_SOFT = "#FFB082";

export default function PortalOverview() {
  const { user } = useAuth();
  const [client, setClient] = useState<any>(null);
  const [contract, setContract] = useState<any>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const [series, setSeries] = useState<{ month: string; kwh: number }[]>([]);
  const [edus, setEdus] = useState<any[]>([]);
  const [ppaCount, setPpaCount] = useState(0);

  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("*").eq("portal_user_id", user.id).maybeSingle();
    setClient(cl);
    if (!cl) return;
    const [{ data: c }, { data: inv }, { data: mps }, { data: ppas }] = await Promise.all([
      supabase.from("supply_contracts").select("*").eq("client_id", cl.id).eq("status", "active").limit(1).maybeSingle(),
      supabase.from("invoices").select("*").eq("client_id", cl.id).in("status", ["draft", "issued", "overdue"]).order("due_date", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("metering_points").select("id, ean, address, has_pv, pv_capacity_kw, contracted_power_kw").eq("client_id", cl.id),
      supabase.from("ppa_agreements").select("id").eq("client_id", cl.id),
    ]);
    setContract(c); setInvoice(inv); setEdus(mps ?? []); setPpaCount((ppas ?? []).length);
    const ids = (mps ?? []).map((m: any) => m.id);
    if (ids.length) {
      const { data: rd } = await supabase.from("meter_readings").select("reading_at, import_kwh, export_kwh").in("metering_point_id", ids);
      const map: Record<string, number> = {};
      (rd ?? []).forEach((r: any) => {
        const m = (r.reading_at as string | null)?.slice(0, 7);
        if (!m) return;
        map[m] = (map[m] ?? 0) + Number(r.import_kwh || 0) - Number(r.export_kwh || 0);
      });
      setSeries(Object.entries(map).sort().slice(-12).map(([month, kwh]) => ({ month: month.slice(5), kwh: Math.round(kwh) })));
    }
  })(); }, [user]);

  const totals = useMemo(() => {
    const total = series.reduce((s, x) => s + x.kwh, 0);
    const last = series[series.length - 1]?.kwh ?? 0;
    const prev = series[series.length - 2]?.kwh ?? 0;
    const delta = prev ? ((last - prev) / prev) * 100 : 0;
    const avg = series.length ? total / series.length : 0;
    const pvKw = edus.reduce((s, e) => s + Number(e.pv_capacity_kw || 0), 0);
    const pvMonthlyKwh = Math.round(pvKw * 120); // ~120 kWh/kWp/mo blended
    return { total, last, prev, delta, avg, pvKw, pvMonthlyKwh };
  }, [series, edus]);

  // 24h synthetic load shape (visual flair, ember-themed)
  const today = useMemo(() => Array.from({ length: 24 }, (_, h) => {
    const base = 0.45 + 0.45 * Math.sin(((h - 7) / 24) * Math.PI * 2);
    const evening = h >= 18 && h <= 22 ? 0.25 : 0;
    return { h: `${h}:00`, kw: Math.max(0.1, Number(((base + evening) * (totals.avg / 720 || 0.6)).toFixed(2))) };
  }), [totals.avg]);

  const co2Kg = Math.round(totals.total * 0.28); // grid intensity heuristic
  const ember = (totals.delta <= 0);

  if (!client) return (
    <PortalLayout title="Welcome">
      <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
        Your account isn't linked to a customer record yet. Please contact your account manager.
      </CardContent></Card>
    </PortalLayout>
  );

  return (
    <PortalLayout title={`Hello, ${client.company_name}`}>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border p-5 md:p-7"
           style={{ background: "radial-gradient(120% 120% at 0% 0%, rgba(255,107,44,0.25) 0%, rgba(255,107,44,0) 55%), linear-gradient(135deg, #1A140F 0%, #100C09 100%)" }}>
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full blur-3xl opacity-40" style={{ background: EMBER }} />
        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest" style={{ color: EMBER_SOFT }}>
              <Flame className="h-3.5 w-3.5" /> Your energy today
            </div>
            <div className="mt-2 text-3xl md:text-4xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {fmtNum(totals.last)} <span className="text-base font-normal text-muted-foreground">kWh last month</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm">
              {ember ? <TrendingDown className="h-4 w-4 text-emerald-400" /> : <TrendingUp className="h-4 w-4" style={{ color: EMBER }} />}
              <span className={ember ? "text-emerald-400" : ""} style={!ember ? { color: EMBER } : {}}>
                {totals.delta > 0 ? "+" : ""}{totals.delta.toFixed(1)}% vs previous month
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary"><Link to="/portal/readings"><Gauge className="h-4 w-4 mr-2" />Submit reading</Link></Button>
            <Button asChild size="sm" style={{ background: EMBER, color: "#1A140F" }}><Link to="/portal/invoices"><Receipt className="h-4 w-4 mr-2" />View invoices</Link></Button>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Receipt} label="Next invoice" value={invoice ? `€${fmtNum(invoice.total_eur)}` : "—"} sub={invoice?.due_date ? `Due ${invoice.due_date}` : "No open invoice"} accent={!!invoice} />
        <Kpi icon={Zap} label="Last 12m" value={`${fmtNum(totals.total / 1000)} MWh`} sub={`Avg ${fmtNum(totals.avg)} kWh/mo`} />
        <Kpi icon={Sun} label="PV potential" value={totals.pvKw ? `${fmtNum(totals.pvKw)} kWp` : "—"} sub={totals.pvKw ? `~${fmtNum(totals.pvMonthlyKwh)} kWh/mo` : "No PV installed"} />
        <Kpi icon={Leaf} label="CO₂ footprint" value={`${fmtNum(co2Kg)} kg`} sub="Last 12 months" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Flame className="h-4 w-4" style={{ color: EMBER }} /> Monthly consumption</CardTitle>
            <Badge variant="secondary" className="text-[10px]">kWh</Badge>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="ember" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={EMBER} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={EMBER} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                <XAxis dataKey="month" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "#1A140F", border: "1px solid #3A3128", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="kwh" stroke={EMBER} strokeWidth={2} fill="url(#ember)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Gauge className="h-4 w-4" style={{ color: EMBER }} /> Today (estimated)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={today} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                <XAxis dataKey="h" fontSize={9} interval={3} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "#1A140F", border: "1px solid #3A3128", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="kw" fill={EMBER} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Sites + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><MapPin className="h-4 w-4" style={{ color: EMBER }} /> Your supply points</CardTitle>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link to="/portal/edus">View all <ArrowRight className="h-3 w-3 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {edus.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No supply points linked yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {edus.slice(0, 5).map((e) => (
                  <li key={e.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{e.address || e.ean}</div>
                      <div className="text-xs text-muted-foreground truncate">EAN {e.ean} · {e.contracted_power_kw ?? "—"} kW</div>
                    </div>
                    {e.has_pv && (
                      <Badge className="text-[10px]" style={{ background: "rgba(255,107,44,0.15)", color: EMBER, border: `1px solid ${EMBER}40` }}>
                        <Sun className="h-3 w-3 mr-1" /> {fmtNum(e.pv_capacity_kw || 0)} kWp PV
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Quick actions</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-2">
            <ActionLink to="/portal/invoices" icon={Receipt} label="Pay an invoice" />
            <ActionLink to="/portal/readings" icon={Gauge} label="Submit meter reading" />
            <ActionLink to="/portal/ppa" icon={Handshake} label={`My PPAs${ppaCount ? ` (${ppaCount})` : ""}`} />
            <ActionLink to="/portal/edus" icon={MapPin} label="Manage supply points" />
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className="overflow-hidden relative">
      {accent && <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: EMBER }} />}
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="h-7 w-7 rounded-md grid place-items-center" style={{ background: "rgba(255,107,44,0.12)", color: EMBER }}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="text-2xl font-semibold mt-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ActionLink({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Link to={to} className="group flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 hover:bg-secondary transition-colors">
      <span className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4" style={{ color: EMBER }} />
        {label}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
    </Link>
  );
}
