import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fmtNum } from "@/lib/format";
import { exportToExcel, exportToPdf } from "@/lib/exports";
import { FileDown, FileText } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from "recharts";

/** Returns YYYY-MM-DD for today */
function today() { return new Date().toISOString().slice(0, 10); }

/** Default load shape (24h) — normalized so sum = 24. Mild commercial profile. */
const DEFAULT_SHAPE = [
  0.55, 0.50, 0.48, 0.47, 0.48, 0.55, 0.75, 1.05, 1.30, 1.40, 1.42, 1.38,
  1.30, 1.25, 1.22, 1.25, 1.32, 1.40, 1.35, 1.20, 1.05, 0.90, 0.75, 0.65,
];

export default function Position() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const [trades, setTrades] = useState<any[]>([]);
  const [forecastMwh, setForecastMwh] = useState(0);
  const [showGeneration, setShowGeneration] = useState(true);
  const [genByHour, setGenByHour] = useState<number[]>(Array(24).fill(0));
  const [showBess, setShowBess] = useState(true);
  const [bessByHour, setBessByHour] = useState<number[]>(Array(24).fill(0));
  const [socByHour, setSocByHour] = useState<(number | null)[]>(Array(24).fill(null));

  useEffect(() => { (async () => {
    if (!user) return;
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;
    const { data: tr } = await supabase.from("trades")
      .select("side, delivery_start, delivery_end, volume_mwh, price_eur_mwh, hub")
      .lte("delivery_start", end).gte("delivery_end", start);
    setTrades(tr ?? []);
    const { data: fc } = await supabase.from("forecasts")
      .select("forecast_mwh").eq("forecast_date", date);
    setForecastMwh((fc ?? []).reduce((s: number, f: any) => s + Number(f.forecast_mwh || 0), 0));
    const { data: assetRows } = await supabase.from("assets").select("id, asset_type");
    const typeById = new Map<string, string>((assetRows ?? []).map((a: any) => [a.id, a.asset_type]));
    const { data: tel } = await supabase.from("asset_telemetry")
      .select("ts, asset_id, pv_generation_kwh, energy_kwh, power_kw, soc_pct")
      .gte("ts", `${date}T00:00:00Z`).lte("ts", `${date}T23:59:59Z`);
    const buckets = Array(24).fill(0);
    const bess = Array(24).fill(0);
    const socSum = Array(24).fill(0);
    const socCount = Array(24).fill(0);
    for (const t of tel ?? []) {
      const h = new Date((t as any).ts).getUTCHours();
      const type = typeById.get((t as any).asset_id) ?? "";
      const isBess = type === "bess" || type === "hybrid";
      if (isBess) {
        // power_kw > 0 = charging (storing), < 0 = discharging (feeding out)
        bess[h] += Number((t as any).power_kw ?? 0) / 1000; // kW -> MW(h over 1h)
        if ((t as any).soc_pct != null) { socSum[h] += Number((t as any).soc_pct); socCount[h] += 1; }
      }
      if (type === "bess") continue; // pure batteries do not generate
      const kwh = Number((t as any).pv_generation_kwh ?? (t as any).energy_kwh ?? 0)
        || Math.max(0, Number((t as any).power_kw ?? 0));
      buckets[h] += kwh / 1000; // kWh -> MWh
    }
    setGenByHour(buckets);
    setBessByHour(bess.map((v) => +v.toFixed(3)));
    setSocByHour(socCount.map((c, h) => (c ? socSum[h] / c : null)));
  })(); }, [user, date]);

  const hourly = useMemo(() => {
    const shapeSum = DEFAULT_SHAPE.reduce((a, b) => a + b, 0);
    const dayStart = new Date(`${date}T00:00:00Z`).getTime();
    return Array.from({ length: 24 }, (_, h) => {
      const hourStart = dayStart + h * 3600_000;
      const hourEnd = hourStart + 3600_000;
      let bought = 0, sold = 0, weightedPrice = 0, priceVol = 0;
      for (const t of trades) {
        const ts = new Date(t.delivery_start).getTime();
        const te = new Date(t.delivery_end).getTime();
        const overlap = Math.max(0, Math.min(te, hourEnd) - Math.max(ts, hourStart));
        if (overlap <= 0) continue;
        const totalSec = (te - ts) / 1000;
        const frac = overlap / 1000 / Math.max(1, totalSec);
        const v = Number(t.volume_mwh || 0) * frac;
        if (t.side === "BUY" || t.side === "buy") bought += v;
        else if (t.side === "SELL" || t.side === "sell") sold += v;
        weightedPrice += v * Number(t.price_eur_mwh || 0);
        priceVol += v;
      }
      const procured = bought - sold; // long if positive
      const consumption = (forecastMwh * DEFAULT_SHAPE[h]) / shapeSum;
      const generated = genByHour[h] || 0;
      const bessNet = bessByHour[h] || 0; // + = charging (consumes), - = discharging (supplies)
      const position = procured + generated - consumption - bessNet;
      return {
        hour: `${String(h).padStart(2, "0")}:00`,
        bought: +bought.toFixed(3),
        sold: +sold.toFixed(3),
        procured: +procured.toFixed(3),
        generated: +generated.toFixed(3),
        bess: +bessNet.toFixed(3),
        soc_pct: socByHour[h] != null ? +Number(socByHour[h]).toFixed(1) : 0,
        consumption: +consumption.toFixed(3),
        position: +position.toFixed(3),
        status: position > 0.001 ? "Long" : position < -0.001 ? "Short" : "Flat",
        avg_price: priceVol > 0 ? +(weightedPrice / priceVol).toFixed(2) : 0,
      };
    });
  }, [trades, forecastMwh, date, genByHour, bessByHour, socByHour]);

  const totals = useMemo(() => hourly.reduce((acc, h) => ({
    procured: acc.procured + h.procured,
    generated: acc.generated + h.generated,
    charged: acc.charged + Math.max(0, h.bess),
    discharged: acc.discharged + Math.max(0, -h.bess),
    consumption: acc.consumption + h.consumption,
    long: acc.long + Math.max(0, h.position),
    short: acc.short + Math.max(0, -h.position),
  }), { procured: 0, generated: 0, charged: 0, discharged: 0, consumption: 0, long: 0, short: 0 }), [hourly]);

  const latestSoc = useMemo(() => {
    for (let h = 23; h >= 0; h--) if (socByHour[h] != null) return Number(socByHour[h]);
    return null;
  }, [socByHour]);

  const cols = [
    { key: "hour", label: "Hour" },
    { key: "bought", label: "Bought (MWh)" },
    { key: "sold", label: "Sold (MWh)" },
    { key: "procured", label: "Net procured" },
    { key: "generated", label: "Generated" },
    { key: "bess", label: "BESS net (+chg/-dis)" },
    { key: "soc_pct", label: "SOC %" },
    { key: "consumption", label: "Consumption" },
    { key: "position", label: "Position" },
    { key: "status", label: "Status" },
    { key: "avg_price", label: "Avg €/MWh" },
  ];

  return (
    <ErpLayout title="Hourly Position" subtitle="See for each hour how much electricity you have over (long) or are missing (short)"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportToExcel(`position_${date}`, [{ name: "Position", columns: cols, rows: hourly }])}>
            <FileDown className="h-4 w-4 mr-1" />Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportToPdf({ filename: `position_${date}`, title: "Hourly position", subtitle: date, sections: [{ heading: "Per-hour breakdown", columns: cols, rows: hourly }] })}>
            <FileText className="h-4 w-4 mr-1" />PDF
          </Button>
        </div>
      }>
      <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Card className="border-border/60 md:col-span-1">
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="date">Delivery date</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="text-xs text-muted-foreground">
              Consumption is derived from the daily forecast spread across 24 hours using a default load shape.
              For SLP-fed customers, individual hourly profiles are used in the Balancing → Scheduling page.
            </div>
            <div className="flex items-center justify-between pt-1">
              <Label htmlFor="gen" className="text-xs">Show generation</Label>
              <Switch id="gen" checked={showGeneration} onCheckedChange={setShowGeneration} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="bess" className="text-xs">Show BESS</Label>
              <Switch id="bess" checked={showBess} onCheckedChange={setShowBess} />
            </div>
          </CardContent>
        </Card>
        <Stat label="Net procured" value={`${fmtNum(totals.procured)} MWh`} />
        <Stat label="Generated" value={`${fmtNum(totals.generated)} MWh`} tone="positive" />
        <Stat label="BESS charged / discharged" value={`${fmtNum(totals.charged)} / ${fmtNum(totals.discharged)} MWh`} />
        <Stat label="Battery SOC" value={latestSoc != null ? `${fmtNum(latestSoc)} %` : "—"} />
        <Stat label="Forecast load" value={`${fmtNum(totals.consumption)} MWh`} />
        <Stat label="Long volume" value={`${fmtNum(totals.long)} MWh`} tone="positive" />
        <Stat label="Short volume" value={`${fmtNum(totals.short)} MWh`} tone="negative" />
      </div>

      <Card className="border-border/60">
        <CardHeader><CardTitle className="text-sm">Hourly position — bars show surplus (▲) and deficit (▼)</CardTitle></CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hourly} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="hour" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="position" name="Position (MWh)" fill="hsl(var(--primary))" />
              <Line type="monotone" dataKey="procured" name="Procured" stroke="hsl(var(--chart-2, 142 70% 45%))" dot={false} />
              {showGeneration && (
                <Line type="monotone" dataKey="generated" name="Generated" stroke="hsl(var(--chart-4, 45 90% 55%))" dot={false} />
              )}
              {showBess && (
                <Bar dataKey="bess" name="BESS net (+charge / −discharge)" fill="hsl(var(--chart-3, 200 80% 55%))" opacity={0.7} />
              )}
              <Line type="monotone" dataKey="consumption" name="Consumption" stroke="hsl(var(--destructive))" strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader><CardTitle className="text-sm">Per-hour breakdown</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              {cols.map(c => <TableHead key={c.key} className={c.key === "hour" ? "" : "text-right"}>{c.label}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {hourly.map((r) => (
                <TableRow key={r.hour}>
                  <TableCell className="font-mono text-xs">{r.hour}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.bought)}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.sold)}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.procured)}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.generated)}</TableCell>
                  <TableCell className={`text-right ${r.bess > 0 ? "text-sky-500" : r.bess < 0 ? "text-amber-500" : ""}`}>{fmtNum(r.bess)}</TableCell>
                  <TableCell className="text-right">{r.soc_pct ? `${fmtNum(r.soc_pct)}%` : "—"}</TableCell>
                  <TableCell className="text-right">{fmtNum(r.consumption)}</TableCell>
                  <TableCell className={`text-right font-medium ${r.position > 0 ? "text-emerald-500" : r.position < 0 ? "text-destructive" : ""}`}>
                    {r.position > 0 ? "+" : ""}{fmtNum(r.position)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.status === "Long" ? "default" : r.status === "Short" ? "destructive" : "secondary"}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{r.avg_price ? `€${fmtNum(r.avg_price)}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const color = tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-destructive" : "";
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}