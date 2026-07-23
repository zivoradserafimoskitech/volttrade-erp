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
  MapPin, Handshake, Sparkles, Car, Gift, Wallet, Activity,
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
  const [balance, setBalance] = useState<number>(0);
  const [rewards, setRewards] = useState<number>(0);

  useEffect(() => { (async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("*").eq("portal_user_id", user.id).maybeSingle();
    setClient(cl);
    if (!cl) return;
    const [{ data: c }, { data: inv }, { data: mps }, { data: ppas }] = await Promise.all([
      supabase.from("supply_contracts").select("*").eq("client_id", cl.id).eq("status", "active").limit(1).maybeSingle(),
      supabase.from("invoices").select("*").eq("client_id", cl.id).in("status", ["draft", "issued", "overdue"]).order("due_date", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("metering_points").select("id, edu_code, address, has_pv, pv_capacity_kw, connected_power_kw").eq("client_id", cl.id),
      supabase.from("ppa_agreements").select("id").eq("client_id", cl.id),
    ]);
    setContract(c); setInvoice(inv);
    const edusNorm = (mps ?? []).map((m: any) => ({
      id: m.id,
      ean: m.edu_code,
      address: m.address,
      has_pv: m.has_pv,
      pv_capacity_kw: m.pv_capacity_kw,
      contracted_power_kw: m.connected_power_kw,
    }));
    setEdus(edusNorm); setPpaCount((ppas ?? []).length);
    // Balance = outstanding invoice total - payments made + rewards credit
    const [{ data: openInv }, { data: pays }, { data: rl }] = await Promise.all([
      supabase.from("invoices").select("total_eur").eq("client_id", cl.id).in("status", ["issued","overdue","draft"]),
      supabase.from("payments").select("amount_eur").eq("client_id", cl.id),
      supabase.from("rewards_ledger").select("amount_eur").eq("client_id", cl.id),
    ]);
    const owed = (openInv ?? []).reduce((s: number, x: any) => s + Number(x.total_eur || 0), 0);
    const paid = (pays ?? []).reduce((s: number, x: any) => s + Number(x.amount_eur || 0), 0);
    const rewardsTotal = (rl ?? []).reduce((s: number, x: any) => s + Number(x.amount_eur || 0), 0);
    setBalance(owed - paid - rewardsTotal);
    setRewards(rewardsTotal);
    const ids = edusNorm.map((m: any) => m.id);
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

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? "Добро утро" : h < 18 ? "Добар ден" : "Добра вечер"; })();
  const firstName = (client?.contact_name || client?.company_name || "").split(" ")[0];
  const due = invoice?.due_date ? new Date(invoice.due_date).toLocaleDateString("mk-MK") : null;
  const overdue = invoice?.due_date ? new Date(invoice.due_date) < new Date() : false;

  const tiles = [
    { to: "/portal/hourly", label: "Потрошувачка", icon: Activity },
    { to: "/portal/invoices", label: "Сметки", icon: Receipt },
    { to: "/portal/tariffs", label: "Тарифа", icon: Zap },
    { to: "/portal/edus", label: "Мерни места", icon: MapPin },
    { to: "/portal/savings", label: "Заштеди", icon: Sparkles },
    { to: "/portal/readings", label: "Внеси отчит", icon: Gauge },
  ];

  return (
    <PortalLayout title="">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          {greeting}{firstName ? `, ${firstName}` : ""}
        </h1>
        {contract?.tariff_id && <p className="text-sm text-muted-foreground mt-1">Тарифа · договор {contract.contract_number}</p>}
      </div>

      {/* Bill hero card (A1-style) */}
      <Card className="border-border/60 overflow-hidden">
        <CardContent className="p-5 md:p-6">
          {invoice ? (
            <>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Вашата сметка {invoice.period_start ? `за ${new Date(invoice.period_start).toLocaleDateString("mk-MK", { month: "long" })}` : ""} е издадена
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {due && <>Рок на плаќање до {due}</>}
                    {overdue && <Badge variant="destructive" className="ml-2 text-[10px]">Достасана</Badge>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl md:text-4xl font-bold" style={{ color: EMBER }}>
                    € {fmtNum(Number(invoice.total_eur || 0), 2)}
                  </div>
                  <div className="text-xs text-muted-foreground">вкупен отворен долг</div>
                </div>
              </div>
              <Button asChild className="w-full mt-4 h-12 text-base font-semibold" style={{ background: EMBER, color: "#1a1510" }}>
                <Link to="/portal/invoices">Плати сега <ArrowRight className="h-4 w-4 ml-2" /></Link>
              </Button>
            </>
          ) : (
            <div className="text-center py-4">
              <Wallet className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <div className="font-medium">Немате отворени сметки</div>
              <div className="text-sm text-muted-foreground mt-1">Сите ваши фактури се платени.</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick tiles */}
      <div className="grid grid-cols-3 gap-3">
        {tiles.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card p-4 hover:bg-secondary/50 transition-colors">
            <Icon className="h-6 w-6" style={{ color: EMBER }} />
            <span className="text-[11px] md:text-xs text-center leading-tight">{label}</span>
          </Link>
        ))}
      </div>

      {/* Consumption chart */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Преглед на потрошувачка</CardTitle>
        </CardHeader>
        <CardContent>
          {series.length ? (
            <>
              <div className="flex items-baseline gap-3 mb-3">
                <span className="text-2xl font-semibold">{fmtNum(totals.last, 0)} kWh</span>
                {totals.prev > 0 && (
                  <span className={`text-sm flex items-center gap-1 ${totals.delta > 0 ? "text-destructive" : "text-emerald-500"}`}>
                    {totals.delta > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {Math.abs(totals.delta).toFixed(0)}% од претходен месец
                  </span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="ember" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={EMBER} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={EMBER} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10 }} />
                  <Area dataKey="kwh" name="kWh" stroke={EMBER} strokeWidth={2} fill="url(#ember)" />
                </AreaChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Сè уште нема податоци за потрошувачка. Ќе се појават по првиот отчит.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Supply points summary */}
      {edus.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Мои мерни места</CardTitle>
            <Link to="/portal/edus" className="text-xs" style={{ color: EMBER }}>Сите</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {edus.slice(0, 3).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{e.ean ?? "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{e.address ?? "—"}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {e.has_pv && <Badge variant="secondary" className="text-[10px]"><Sun className="h-3 w-3 mr-1" />PV</Badge>}
                  {e.contracted_power_kw && <span className="text-xs text-muted-foreground">{e.contracted_power_kw} kW</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Rewards / PPA strip */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/60">
          <CardContent className="p-4">
            <Gift className="h-5 w-5 mb-2" style={{ color: EMBER }} />
            <div className="text-lg font-semibold">€ {fmtNum(rewards, 2)}</div>
            <div className="text-xs text-muted-foreground">Награди</div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4">
            <Handshake className="h-5 w-5 mb-2" style={{ color: EMBER }} />
            <div className="text-lg font-semibold">{ppaCount}</div>
            <div className="text-xs text-muted-foreground">PPA договори</div>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
}
