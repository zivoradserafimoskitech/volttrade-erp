import { useEffect, useMemo, useRef, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/erp/StatCard";
import { Activity, Zap, Euro, Leaf, Radio, Database, Wifi } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area, PieChart, Pie, Cell, RadialBarChart, RadialBar
} from "recharts";

type Source = "demo" | "realtime" | "influx";

// ---------- helpers ----------
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function clearSkyFactor(hour: number) {
  if (hour < 6 || hour > 20) return 0;
  return Math.sin(((hour - 6) / 14) * Math.PI);
}

function baseLoadKw(hour: number) {
  // morning + evening peaks
  const morning = 1.8 * Math.exp(-Math.pow((hour - 7.5) / 1.6, 2));
  const evening = 2.6 * Math.exp(-Math.pow((hour - 19) / 1.8, 2));
  return 0.45 + morning + evening;
}

function carbonIntensity(hour: number) {
  // gCO2/kWh – lower midday when solar dominates
  const solar = clearSkyFactor(hour);
  return Math.round(420 - 180 * solar + 40 * Math.sin(hour / 3));
}

function spotPrice(hour: number) {
  // €/MWh wholesale curve with morning/evening peaks
  const morning = 40 * Math.exp(-Math.pow((hour - 8) / 2, 2));
  const evening = 90 * Math.exp(-Math.pow((hour - 19) / 2, 2));
  const solarDip = -35 * clearSkyFactor(hour);
  return Math.max(15, 65 + morning + evening + solarDip);
}

function agilePriceCt(hour: number, marginCt = 2.5, vat = 1.05) {
  // ct/kWh = spot(€/MWh)/10 + margin, * VAT-ish factor
  return ((spotPrice(hour) / 10) + marginCt) * vat;
}

// ---------- LIVE GAUGE ----------
function Gauge({ value, max, label, unit, color }: { value: number; max: number; label: string; unit: string; color: string }) {
  const data = [{ name: label, value: Math.min(value, max), fill: color }];
  return (
    <div className="relative h-48">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="70%" outerRadius="100%" data={data} startAngle={210} endAngle={-30}>
          <RadialBar dataKey="value" cornerRadius={10} background={{ fill: "hsl(var(--secondary))" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-3xl font-semibold tabular-nums tracking-tight transition-all">
          {value.toFixed(2)}
          <span className="text-sm text-muted-foreground ml-1">{unit}</span>
        </div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground mt-1">{label}</div>
      </div>
    </div>
  );
}

// ---------- main page ----------
export default function SmartMeter() {
  const [source, setSource] = useState<Source>("demo");
  const [connected, setConnected] = useState(false);

  // live state (kW now, kWh today, €/kWh now, gCO2/kWh)
  const [livePowerKw, setLivePowerKw] = useState(0);
  const [todayKwh, setTodayKwh] = useState(0);
  const [series, setSeries] = useState<{ t: string; kw: number; price: number; carbon: number }[]>([]);
  const startRef = useRef(Date.now());

  // demo tick
  useEffect(() => {
    if (source !== "demo") return;
    const tick = () => {
      const now = new Date();
      const h = now.getHours() + now.getMinutes() / 60;
      const noise = (Math.random() - 0.5) * 0.6;
      const kw = Math.max(0.1, baseLoadKw(h) + noise);
      const price = agilePriceCt(h);
      const carbon = carbonIntensity(Math.floor(h));
      setLivePowerKw(kw);
      setTodayKwh(v => v + kw / 3600); // per-second
      setSeries(s => [...s.slice(-119), { t: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), kw, price, carbon }]);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [source]);

  // realtime / influx placeholders
  useEffect(() => {
    if (source === "demo") { setConnected(false); return; }
    // TODO: wire Supabase Realtime channel on `consumption_readings`
    //       or call edge function `sync-influx-forecasts` for InfluxDB pull.
    setConnected(false);
  }, [source]);

  const nowHour = new Date().getHours();
  const nowPriceCt = agilePriceCt(nowHour + new Date().getMinutes() / 60);
  const nowCarbon = carbonIntensity(nowHour);

  return (
    <ErpLayout
      title="Smart Meter & Tariff Workbench"
      subtitle="Live consumption, Agile-style hourly pricing, and usage analytics"
      actions={
        <div className="flex items-center gap-2">
          <Select value={source} onValueChange={(v) => setSource(v as Source)}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="demo">Demo (simulated)</SelectItem>
              <SelectItem value="realtime">Realtime DB</SelectItem>
              <SelectItem value="influx">InfluxDB</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant={source === "demo" ? "secondary" : connected ? "default" : "outline"} className="gap-1">
            {source === "demo" ? <Radio className="h-3 w-3" /> : source === "influx" ? <Database className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
            {source === "demo" ? "DEMO" : connected ? "LIVE" : "DISCONNECTED"}
          </Badge>
        </div>
      }
    >
      <Tabs defaultValue="live" className="space-y-6">
        <TabsList>
          <TabsTrigger value="live">Live Dashboard</TabsTrigger>
          <TabsTrigger value="tariff">Agile Tariff Simulator</TabsTrigger>
          <TabsTrigger value="analytics">Usage Analytics</TabsTrigger>
        </TabsList>

        {/* LIVE */}
        <TabsContent value="live" className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Power now" value={`${livePowerKw.toFixed(2)} kW`} icon={Zap} hint="Instantaneous demand" />
            <StatCard label="Today" value={`${todayKwh.toFixed(2)} kWh`} icon={Activity} accent="accent" hint="Cumulative since session start" />
            <StatCard label="Price now" value={`${nowPriceCt.toFixed(2)} ct/kWh`} icon={Euro} accent="warning" hint="Agile hourly tariff" />
            <StatCard label="Carbon now" value={`${nowCarbon} gCO₂/kWh`} icon={Leaf} accent={nowCarbon < 300 ? "primary" : "destructive"} hint="Grid intensity" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-border/60 bg-card/60 backdrop-blur">
              <CardHeader><CardTitle className="text-sm">Power demand</CardTitle></CardHeader>
              <CardContent><Gauge value={livePowerKw} max={8} label="kW" unit="kW" color="hsl(var(--primary))" /></CardContent>
            </Card>
            <Card className="border-border/60 bg-card/60 backdrop-blur">
              <CardHeader><CardTitle className="text-sm">Tariff rate</CardTitle></CardHeader>
              <CardContent><Gauge value={nowPriceCt} max={40} label="ct/kWh" unit="ct" color="hsl(var(--accent))" /></CardContent>
            </Card>
            <Card className="border-border/60 bg-card/60 backdrop-blur">
              <CardHeader><CardTitle className="text-sm">Carbon intensity</CardTitle></CardHeader>
              <CardContent><Gauge value={nowCarbon} max={600} label="gCO₂/kWh" unit="g" color={nowCarbon < 300 ? "hsl(var(--primary))" : "hsl(var(--destructive))"} /></CardContent>
            </Card>
          </div>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Live power stream</CardTitle>
              <CardDescription>1-second resolution · last 2 minutes</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="kwFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="kw" stroke="hsl(var(--primary))" fill="url(#kwFill)" strokeWidth={2} isAnimationActive={false} name="kW" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TARIFF */}
        <TabsContent value="tariff"><TariffSimulator /></TabsContent>

        {/* ANALYTICS */}
        <TabsContent value="analytics"><UsageAnalytics /></TabsContent>
      </Tabs>
    </ErpLayout>
  );
}

// ---------- TARIFF SIMULATOR ----------
function TariffSimulator() {
  const [margin, setMargin] = useState(2.5);
  const [vatPct, setVatPct] = useState(5);
  const [capCt, setCapCt] = useState(35);
  const [floorCt, setFloorCt] = useState(0);
  const [enableCap, setEnableCap] = useState(true);

  const data = useMemo(() => HOURS.map(h => {
    const spot = spotPrice(h);
    let agile = (spot / 10 + margin) * (1 + vatPct / 100);
    if (enableCap) agile = Math.min(capCt, Math.max(floorCt, agile));
    const load = baseLoadKw(h);
    return {
      hour: `${String(h).padStart(2, "0")}:00`,
      spot: +spot.toFixed(2),
      agile: +agile.toFixed(2),
      load: +load.toFixed(2),
      cost: +(agile * load).toFixed(2),
    };
  }), [margin, vatPct, capCt, floorCt, enableCap]);

  const totalKwh = data.reduce((s, d) => s + d.load, 0);
  const totalCost = data.reduce((s, d) => s + d.cost, 0) / 100; // €
  const avgPrice = data.reduce((s, d) => s + d.agile, 0) / data.length;
  const cheapest = [...data].sort((a, b) => a.agile - b.agile).slice(0, 4).map(d => d.hour);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1 border-border/60">
          <CardHeader><CardTitle>Tariff configuration</CardTitle><CardDescription>24 hourly bands · wholesale + margin</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <SliderRow label={`Supplier margin: ${margin.toFixed(2)} ct/kWh`} value={margin} min={0} max={10} step={0.1} onChange={setMargin} />
            <SliderRow label={`VAT / levies: ${vatPct}%`} value={vatPct} min={0} max={27} step={1} onChange={setVatPct} />
            <div className="flex items-center justify-between">
              <Label htmlFor="cap-sw">Apply price cap / floor</Label>
              <Switch id="cap-sw" checked={enableCap} onCheckedChange={setEnableCap} />
            </div>
            {enableCap && (
              <>
                <SliderRow label={`Price cap: ${capCt} ct/kWh`} value={capCt} min={10} max={80} step={1} onChange={setCapCt} />
                <SliderRow label={`Price floor: ${floorCt} ct/kWh`} value={floorCt} min={0} max={20} step={1} onChange={setFloorCt} />
              </>
            )}

            <div className="pt-3 border-t border-border/60 grid grid-cols-2 gap-3 text-sm">
              <KV k="Daily kWh" v={`${totalKwh.toFixed(1)} kWh`} />
              <KV k="Daily cost" v={`€ ${totalCost.toFixed(2)}`} />
              <KV k="Avg rate" v={`${avgPrice.toFixed(2)} ct`} />
              <KV k="Effective" v={`${(totalCost * 100 / totalKwh).toFixed(2)} ct`} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Cheapest hours today</div>
              <div className="flex flex-wrap gap-1.5">
                {cheapest.map(h => <Badge key={h} variant="secondary">{h}</Badge>)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-border/60">
          <CardHeader><CardTitle>Hourly Agile rate vs wholesale</CardTitle><CardDescription>€/MWh wholesale rebuilt into ct/kWh retail</CardDescription></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} label={{ value: "ct/kWh", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis yAxisId="r" orientation="right" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} label={{ value: "€/MWh", angle: 90, position: "insideRight", fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Line yAxisId="l" type="stepAfter" dataKey="agile" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} name="Agile rate (ct/kWh)" />
                <Line yAxisId="r" type="monotone" dataKey="spot" stroke="hsl(var(--accent))" strokeWidth={2} strokeDasharray="4 3" dot={false} name="Wholesale spot (€/MWh)" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Hourly cost breakdown</CardTitle><CardDescription>cost = load × Agile rate</CardDescription></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
              <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: any) => [`${(v as number).toFixed(2)} ct`, "Cost"]} />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.agile > 25 ? "hsl(var(--destructive))" : d.agile > 15 ? "hsl(var(--warning))" : "hsl(var(--primary))"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-widest text-muted-foreground">{label}</Label>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-secondary/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className="text-sm font-semibold tabular-nums">{v}</div>
    </div>
  );
}

// ---------- USAGE ANALYTICS ----------
function UsageAnalytics() {
  const hourly = useMemo(() => HOURS.map(h => {
    const load = baseLoadKw(h);
    const price = agilePriceCt(h);
    return {
      hour: `${String(h).padStart(2, "0")}`,
      kwh: +load.toFixed(2),
      cost: +(load * price / 100).toFixed(3),
      carbon: carbonIntensity(h),
    };
  }), []);

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekly = useMemo(() => dayNames.map((d, i) => {
    const factor = i >= 5 ? 1.2 : 1.0;
    const kwh = hourly.reduce((s, h) => s + h.kwh, 0) * factor;
    const cost = hourly.reduce((s, h) => s + h.cost, 0) * factor;
    return { day: d, kwh: +kwh.toFixed(1), cost: +cost.toFixed(2) };
  }), [hourly]);

  const totalKwh = hourly.reduce((s, h) => s + h.kwh, 0);
  const totalCost = hourly.reduce((s, h) => s + h.cost, 0);
  const avgCarbon = hourly.reduce((s, h) => s + h.carbon, 0) / hourly.length;

  const breakdown = [
    { name: "Heating", value: 38, fill: "hsl(var(--primary))" },
    { name: "Appliances", value: 24, fill: "hsl(var(--accent))" },
    { name: "Lighting", value: 11, fill: "hsl(var(--warning))" },
    { name: "EV charging", value: 18, fill: "hsl(var(--destructive))" },
    { name: "Standby", value: 9, fill: "hsl(var(--muted-foreground))" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Daily energy" value={`${totalKwh.toFixed(1)} kWh`} icon={Zap} />
        <StatCard label="Daily cost" value={`€ ${totalCost.toFixed(2)}`} icon={Euro} accent="warning" />
        <StatCard label="Avg carbon" value={`${avgCarbon.toFixed(0)} g/kWh`} icon={Leaf} accent={avgCarbon < 320 ? "primary" : "destructive"} />
        <StatCard label="Peak hour" value={`${hourly.reduce((a, b) => a.kwh > b.kwh ? a : b).hour}:00`} icon={Activity} accent="accent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader><CardTitle>24h consumption pattern</CardTitle><CardDescription>kWh and € side by side</CardDescription></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="r" orientation="right" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Bar yAxisId="l" dataKey="kwh" name="kWh" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                <Bar yAxisId="r" dataKey="cost" name="€" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader><CardTitle>Cost breakdown</CardTitle><CardDescription>Disaggregated end-uses</CardDescription></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {breakdown.map((b, i) => <Cell key={i} fill={b.fill} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: any) => [`${v}%`, ""]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/60">
          <CardHeader><CardTitle>Weekly trend</CardTitle><CardDescription>kWh and cost per day</CardDescription></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekly}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="kwh" stroke="hsl(var(--primary))" strokeWidth={2} name="kWh" />
                <Line type="monotone" dataKey="cost" stroke="hsl(var(--accent))" strokeWidth={2} name="€" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader><CardTitle>Carbon intensity by hour</CardTitle><CardDescription>gCO₂/kWh · greener midday from solar</CardDescription></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourly}>
                <defs>
                  <linearGradient id="cFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Area type="monotone" dataKey="carbon" stroke="hsl(var(--destructive))" fill="url(#cFill)" strokeWidth={2} name="gCO₂/kWh" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}