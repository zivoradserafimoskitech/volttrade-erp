import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/erp/StatCard";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { buildEssMessage, tradeQuantities, classifyTrade, downloadXml, scheduleWindow, type EssSeries } from "@/lib/essSchedule";
import { toast } from "@/hooks/use-toast";
import { shape24h, SlpCategory, seasonOf, dayTypeOf, loadSlpFromDb, loadHolidays } from "@/lib/slpSynthesis";
import { CalendarClock, Lock, Send, Activity, Download, FileCode, Sun, Percent } from "lucide-react";

export default function Scheduling() {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [bg, setBg] = useState<string>("");
  const [date, setDate] = useState<string>(() => new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  const [profiledMwh, setProfiledMwh] = useState(24); // total day
  const [measuredMwh, setMeasuredMwh] = useState(12);
  const [pvKwp, setPvKwp] = useState(500);
  const [profileCat, setProfileCat] = useState<SlpCategory>("Office");
  const [version, setVersion] = useState(1);
  const [gateClosed, setGateClosed] = useState<string | null>(null);
  const [pvHourly, setPvHourly] = useState<number[] | null>(null); // MWh per hour from pv_forecasts

  async function loadPvForecast() {
    const dayStart = `${date}T00:00:00Z`;
    const dayEnd = `${date}T23:59:59Z`;
    const { data } = await (supabase.from as any)("pv_forecasts").select("ts, forecast_kwh").gte("ts", dayStart).lte("ts", dayEnd);
    if (!data?.length) { setPvHourly(null); return false; }
    const byHour = Array.from({ length: 24 }, () => 0);
    for (const r of data as any[]) byHour[new Date(r.ts).getUTCHours()] += Number(r.forecast_kwh || 0) / 1000;
    setPvHourly(byHour);
    return true;
  }
  useEffect(() => { loadPvForecast(); }, [date]);

  // ── ППЕЕ coefficients (published by ОПЕЕ one day ahead) ──
  const [ppeeOpen, setPpeeOpen] = useState(false);
  const [ppeeText, setPpeeText] = useState("");
  async function savePpee() {
    const nums = ppeeText.split(/[\s,;]+/).map(x => x.replace(",", ".")).filter(Boolean).map(Number).filter(n => isFinite(n));
    if (nums.length !== 24) {
      toast({ title: `Expected 24 values, got ${nums.length}`, description: "Paste the hourly ППЕЕ share (%) for the day, hours 1–24.", variant: "destructive" });
      return;
    }
    const rows = nums.map((v, i) => ({ delivery_date: date, hour: i + 1, coefficient_pct: v, is_final: true, source: "OPEE" }));
    const { error } = await (supabase.from as any)("ppee_coefficients").upsert(rows, { onConflict: "delivery_date,hour" });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `ППЕЕ coefficients saved for ${date}`, description: `Average ${(nums.reduce((a, b) => a + b, 0) / 24).toFixed(2)}%` });
    setPpeeOpen(false); setPpeeText("");
  }

  // ── ESS export: PPS (production schedule) per metering point ──
  const [plants, setPlants] = useState<{ id: string; eic_code: string; edu_code: string | null; producer_party_eic: string | null }[]>([]);
  const [plant, setPlant] = useState<string>("");
  useEffect(() => {
    (supabase.from as any)("metering_points")
      .select("id, eic_code, edu_code, producer_party_eic")
      .not("eic_code", "is", null).eq("status", "active")
      .then(({ data }: any) => { setPlants(data ?? []); if (data?.[0] && !plant) setPlant(data[0].id); });
  }, []);

  async function exportPps() {
    const mp = plants.find(p => p.id === plant);
    if (!mp) { toast({ title: "No production point selected", description: "Add an EIC (Z-code) to a metering point first.", variant: "destructive" }); return; }
    const { data: settings } = await (supabase.from as any)("ess_settings").select("*").limit(1).maybeSingle();
    if (!settings?.sender_eic || settings.sender_eic === "CHANGE_ME_SENDER_EIC") {
      toast({ title: "Set your party EIC first", description: "ess_settings.sender_eic must be your BRP EIC.", variant: "destructive" });
      return;
    }
    const home = settings.default_area_eic || "10YMK-MEPSO----8";
    const win = scheduleWindow(date);

    // Hourly PV forecast → MW per quarter-hour (kWh in an hour = mean kW that hour)
    const { data: fc } = await (supabase.from as any)("pv_forecasts")
      .select("ts, forecast_kwh").eq("metering_point_id", mp.id)
      .gte("ts", win.start.toISOString()).lt("ts", win.end.toISOString());
    const byHour = new Map<number, number>();
    for (const r of ((fc ?? []) as any[])) byHour.set(new Date(r.ts).getTime(), Number(r.forecast_kwh || 0) / 1000);
    const quantities = Array.from({ length: win.positions }, (_, i) => {
      const t = win.start.getTime() + i * 900000;
      const hourStart = Math.floor(t / 3600000) * 3600000;
      return byHour.get(hourStart) ?? 0;
    });
    if (!quantities.some(q => q > 0)) {
      toast({ title: "No production forecast for this date", description: "Run Sync PV first, or the plant has no forecast rows.", variant: "destructive" });
      return;
    }

    const stamp = date.replace(/-/g, "");
    const xml = buildEssMessage({
      messageId: `${stamp}_PPS_${mp.eic_code}`,
      messageVersion: version,
      dateISO: date,
      settings,
      series: [{
        seriesId: `${(mp.edu_code || "PROD").replace(/\s+/g, "_")}_PRODUCTION`,
        version,
        businessType: "A01",
        objectAggregation: "A02",
        inArea: home,
        outArea: null,
        inParty: mp.producer_party_eic || settings.sender_eic,
        outParty: null,
        meteringPoint: mp.eic_code,
        quantities,
      }],
    });
    downloadXml(`${stamp}_PPS_${mp.eic_code}_${String(version).padStart(3, "0")}.xml`, xml);
    const mwh = quantities.reduce((a, b) => a + b, 0) / 4;
    toast({ title: `PPS exported — ${mp.eic_code}`, description: `${mwh.toFixed(1)} MWh, peak ${Math.max(...quantities).toFixed(1)} MW` });
  }

  // ── ESS export: TPS from Trade Blotter + consumption leg from this nomination ──
  async function exportTps() {
    const [{ data: settings }, { data: trades }, { data: cps }] = await Promise.all([
      (supabase.from as any)("ess_settings").select("*").limit(1).maybeSingle(),
      (supabase.from as any)("trades").select("*, counterparties(eic_code, short_name, legal_name)")
        .eq("schedulable", true).lte("delivery_start", `${date}T23:59:59Z`).gte("delivery_end", `${date}T00:00:00Z`),
      (supabase.from as any)("counterparties").select("id, eic_code").limit(1),
    ]);
    if (!settings?.sender_eic || settings.sender_eic === "CHANGE_ME_SENDER_EIC") {
      toast({ title: "Set your party EIC first", description: "Admin → ESS settings: sender_eic must be your BRP EIC code.", variant: "destructive" });
      return;
    }
    const home = settings.default_area_eic || "10YMK-MEPSO----8";
    const series: EssSeries[] = [];

    // 1) One time series per schedulable trade
    for (const t of ((trades ?? []) as any[])) {
      const c = classifyTrade(t, home);
      const cpEic = t.counterparties?.eic_code || null;
      const buying = String(t.side).toLowerCase().startsWith("b");
      series.push({
        seriesId: t.ess_series_id || t.trade_number,
        version,
        businessType: c.businessType,
        objectAggregation: c.objectAggregation,
        inArea: c.inArea,
        outArea: c.outArea,
        inParty: buying ? settings.sender_eic : cpEic,
        outParty: buying ? cpEic : settings.sender_eic,
        capacityContractType: c.capacityContractType,
        capacityAgreementId: t.capacity_agreement_id || null,
        quantities: tradeQuantities(t, date),
      });
    }

    // 2) Consumption leg — the nominated portfolio load (profiled + measured),
    //    i.e. exactly what this page publishes to balance_schedules.
    const consumption = rows.map(r => Number(r.profiled || 0) + Number(r.measured || 0)).map(v => v * 4); // MWh/MTU → MW
    if (consumption.some(v => v > 0)) {
      series.push({
        seriesId: "PORTFOLIO_CONSUMPTION",
        version,
        businessType: "A04",
        objectAggregation: "A03",
        inArea: null,
        outArea: home,
        inParty: null,
        outParty: settings.sender_eic,
        quantities: consumption,
      });
    }

    // 3) ППЕЕ purchase from ОПЕЕ — Правила за пазар, Прилог 1 т.4:
    //    TPS_ППЕЕПТ = p[%] × TPS_снабдувач, per hour, rounded to 3 decimals.
    const { data: coef } = await (supabase.from as any)("ppee_coefficients")
      .select("hour, coefficient_pct").eq("delivery_date", date).order("hour");
    if (coef?.length && consumption.some(v => v > 0)) {
      const byHour = new Map<number, number>(((coef ?? []) as any[]).map(c => [Number(c.hour), Number(c.coefficient_pct)]));
      const ppee = consumption.map((mw, i) => {
        const hour = Math.floor(i / 4) + 1;               // Pos 1–4 → hour 1
        return mw * (byHour.get(hour) ?? 0) / 100;
      });
      if (ppee.some(v => v > 0)) {
        series.push({
          seriesId: settings.ppee_series_id || "PPEE_BUY",
          version,
          businessType: "A02",
          objectAggregation: "A03",
          inArea: home,
          outArea: home,
          inParty: settings.sender_eic,
          outParty: settings.opee_eic || null,
          quantities: ppee,
        });
      }
    } else if (consumption.some(v => v > 0)) {
      toast({ title: "ППЕЕ series skipped", description: `No ОПЕЕ coefficients stored for ${date} — add them to include the ППЕЕ purchase.` });
    }

    if (!series.length) {
      toast({ title: "Nothing to export", description: "No schedulable trades for this date and no nominated load.", variant: "destructive" });
      return;
    }
    const stamp = date.replace(/-/g, "");
    const xml = buildEssMessage({
      messageId: `${stamp}_TPS_${settings.sender_eic}`,
      messageVersion: version,
      dateISO: date,
      settings,
      series,
    });
    downloadXml(`${stamp}_TPS_${settings.sender_eic}_${String(version).padStart(3, "0")}.xml`, xml);
    toast({ title: `TPS exported — ${series.length} time series`, description: `${(trades ?? []).length} trades + consumption leg, v${version}` });
  }

  async function syncPv() {
    const { data, error } = await supabase.functions.invoke("sync-pv-forecast", { body: { horizon_hours: 48 } });
    if (error || !data?.ok) { toast({ title: "PV sync failed", description: error?.message ?? data?.error, variant: "destructive" }); return; }
    const got = await loadPvForecast();
    toast({ title: `PV forecast synced (${data.sites} sites, ${data.rows} hours)`, description: got ? "PV leg now uses the forecast." : "No rows for this date — sinusoid fallback." });
  }

  useEffect(() => { supabase.from("balance_groups").select("id,name").then(({ data }) => { setGroups(data ?? []); if (data?.[0]) setBg(data[0].id); }); loadSlpFromDb(supabase); loadHolidays(supabase); }, []);

  // Bridge: daily client forecasts → MTU nomination inputs.
  // Splits the day's total forecast into PROFILED/MEASURED legs using
  // metering_points.metering_category weighted by connected_power_kw.
  async function loadFromForecast() {
    const [{ data: fc }, { data: cps }] = await Promise.all([
      supabase.from("forecasts").select("client_id, forecast_mwh").eq("forecast_date", date),
      (supabase.from as any)("metering_points").select("client_id, metering_category, connected_power_kw").eq("status", "active"),
    ]);
    if (!fc?.length) { toast({ title: "No forecasts for this date", description: "Create daily forecasts in Forecasting first.", variant: "destructive" }); return; }
    const total = fc.reduce((s, r: any) => s + Number(r.forecast_mwh || 0), 0);
    let prof = 0, meas = 0;
    for (const r of fc as any[]) {
      const clientCps = (cps ?? []).filter((c: any) => c.client_id === r.client_id);
      if (!clientCps.length) { prof += Number(r.forecast_mwh || 0); continue; } // unclassified → profiled
      const w = (cat: string) => clientCps.filter((c: any) => c.metering_category === cat).reduce((s: number, c: any) => s + Number(c.connected_power_kw || 1), 0);
      const wp = w("PROFILED"), wm = w("MEASURED"), ws = wp + wm || 1;
      prof += Number(r.forecast_mwh || 0) * wp / ws;
      meas += Number(r.forecast_mwh || 0) * wm / ws;
    }
    setProfiledMwh(+prof.toFixed(3));
    setMeasuredMwh(+meas.toFixed(3));
    toast({ title: `Forecast loaded: ${total.toFixed(1)} MWh`, description: `Profiled ${prof.toFixed(1)} / Measured ${meas.toFixed(1)} — adjust before publishing if needed.` });
  }

  const rows = useMemo(() => {
    const d = new Date(date + "T00:00:00");
    const shape = shape24h(profileCat, seasonOf(d), dayTypeOf(d));
    // expand to 96 MTU (15min) by replicating hourly share / 4
    return Array.from({ length: 96 }, (_, mtu) => {
      const h = Math.floor(mtu / 4);
      const share = shape[h] / 4;
      // PV: real forecast (weather-based, per-site calibrated) when available;
      // clear-sky sinusoid only as fallback for dates without forecast rows.
      const solar = h < 6 || h > 20 ? 0 : Math.sin(((h - 6) / 14) * Math.PI);
      const pvMwh = pvHourly ? pvHourly[h] / 4 : (pvKwp * solar) / 1000 / 4;
      const profiled = profiledMwh * share;
      // measured: stable + small peaks
      const m = (Math.exp(-Math.pow((h - 10) / 3, 2)) + Math.exp(-Math.pow((h - 19) / 3, 2))) ;
      const measured = (measuredMwh / 24) * (1 + 0.3 * m);
      const nop = profiled + measured - pvMwh;
      return { mtu, label: `${String(Math.floor(mtu / 4)).padStart(2, "0")}:${String((mtu % 4) * 15).padStart(2, "0")}`, profiled: +profiled.toFixed(4), measured: +(measured / 4).toFixed(4), pv: +pvMwh.toFixed(4), nop: +nop.toFixed(4) };
    });
  }, [date, profiledMwh, measuredMwh, pvKwp, profileCat, pvHourly]);

  const totals = {
    profiled: rows.reduce((s, r) => s + r.profiled, 0),
    measured: rows.reduce((s, r) => s + r.measured, 0),
    pv: rows.reduce((s, r) => s + r.pv, 0),
    nop: rows.reduce((s, r) => s + r.nop, 0),
  };

  async function publish() {
    if (!bg) { toast({ title: "Pick a balance group", variant: "destructive" }); return; }
    const ts = new Date().toISOString();
    const payload = rows.flatMap(r => ([
      { balance_group_id: bg, date, mtu: r.mtu, scheduled_mwh: r.profiled, leg: "PROFILED" as const, version, gate_closure_ts: ts },
      { balance_group_id: bg, date, mtu: r.mtu, scheduled_mwh: r.measured, leg: "MEASURED" as const, version, gate_closure_ts: ts },
      { balance_group_id: bg, date, mtu: r.mtu, scheduled_mwh: r.pv, leg: "PV" as const, version, gate_closure_ts: ts },
    ]));
    const { error } = await supabase.from("balance_schedules").upsert(payload, { onConflict: "balance_group_id,date,mtu,leg,version" });
    if (error) { toast({ title: "Publish failed", description: error.message, variant: "destructive" }); return; }
    setGateClosed(ts);
    toast({ title: `Schedule v${version} published`, description: `Gate closure ${new Date(ts).toLocaleString()}` });
  }

  async function submitToTso() {
    const fn = await supabase.functions.invoke("submit-schedule", { body: { balance_group_id: bg, date, version } });
    if (fn.error) { toast({ title: "TSO submit failed", description: fn.error.message, variant: "destructive" }); return; }
    toast({ title: "Submitted to TSO (stub)", description: `Ack: ${(fn.data as any)?.ack ?? "OK"}` });
  }

  return (
    <ErpLayout title="Scheduling & Nomination" subtitle="Profiled (SLP) + Measured + PV legs · NOP per MTU"
      actions={<>
        <Button size="sm" variant="outline" onClick={loadFromForecast}><Download className="h-4 w-4 mr-1" />Load from forecast</Button>
        <Button size="sm" variant="outline" onClick={() => setPpeeOpen(true)}><Percent className="h-4 w-4 mr-1" />ППЕЕ %</Button>
        <Button size="sm" variant="outline" onClick={exportTps}><FileCode className="h-4 w-4 mr-1" />Export TPS</Button>
        {plants.length > 0 && (
          <>
            <Select value={plant} onValueChange={setPlant}>
              <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Plant" /></SelectTrigger>
              <SelectContent>{plants.map(p => <SelectItem key={p.id} value={p.id}>{p.eic_code}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={exportPps}><Sun className="h-4 w-4 mr-1" />Export PPS</Button>
          </>
        )}
        <Button size="sm" variant="outline" onClick={syncPv}><Activity className="h-4 w-4 mr-1" />Sync PV{pvHourly ? " ✓" : ""}</Button>
        <Button size="sm" variant="outline" onClick={publish}><Lock className="h-4 w-4 mr-1" />Publish v{version}</Button>
        <Button size="sm" onClick={submitToTso}><Send className="h-4 w-4 mr-1" />Submit to TSO</Button>
      </>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Profiled day total" value={`${totals.profiled.toFixed(2)} MWh`} icon={Activity} />
        <StatCard label="Measured day total" value={`${totals.measured.toFixed(2)} MWh`} icon={Activity} accent="accent" />
        <StatCard label="PV generation" value={`${totals.pv.toFixed(2)} MWh`} icon={Activity} accent="primary" />
        <StatCard label="Net position" value={`${totals.nop.toFixed(2)} MWh`} icon={CalendarClock} accent={totals.nop > 0 ? "warning" : "primary"} />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Inputs</CardTitle>
          <CardDescription>Profiled leg shape = SLP × volume forecast · Imbalance ≈ 0 by construction</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field label="Balance group"><Select value={bg} onValueChange={setBg}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Profiled MWh / day"><Input type="number" value={profiledMwh} onChange={e => setProfiledMwh(+e.target.value)} /></Field>
          <Field label="Measured MWh / day"><Input type="number" value={measuredMwh} onChange={e => setMeasuredMwh(+e.target.value)} /></Field>
          <Field label="PV kWp"><Input type="number" value={pvKwp} onChange={e => setPvKwp(+e.target.value)} /></Field>
          <Field label="Version"><Input type="number" value={version} onChange={e => setVersion(+e.target.value)} /></Field>
          {gateClosed && <div className="md:col-span-6 text-xs text-muted-foreground">Last gate closure: <Badge variant="secondary">{new Date(gateClosed).toLocaleString()}</Badge></div>}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle>Net position per MTU</CardTitle><CardDescription>15-minute settlement basis · feeds Trading NOP</CardDescription></CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={rows}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="profiled" stackId="load" name="Profiled" fill="hsl(var(--primary))" />
              <Bar dataKey="measured" stackId="load" name="Measured" fill="hsl(var(--accent))" />
              <Bar dataKey="pv" name="PV" fill="hsl(var(--warning))" />
              <Line type="monotone" dataKey="nop" name="NOP" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Dialog open={ppeeOpen} onOpenChange={setPpeeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ППЕЕ коефициенти — {date}</DialogTitle>
            <DialogDescription>
              Конечната часовна прогноза за учество на ППЕЕ ја објавува ОПЕЕ еден ден однапред
              (opee.mepso.com.mk). Залепете 24 вредности во проценти, час 1–24.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={5} value={ppeeText} onChange={e => setPpeeText(e.target.value)}
            placeholder="14.92 15.3 16.1 …" />
          <p className="text-xs text-muted-foreground">
            Номинацијата се пресметува како ППЕЕ = коефициент × номинирана потрошувачка (Прилог 1, т.4).
          </p>
          <Button onClick={savePpee}>Зачувај</Button>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>{children}</div>;
}