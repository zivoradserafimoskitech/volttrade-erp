import { useEffect, useMemo, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Car, Plug, BatteryCharging, Sparkles, Zap, Plus, Trash2 } from "lucide-react";
import { fmtNum } from "@/lib/format";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { optimiseChargePlan, syntheticPrices, type PriceSlot } from "@/lib/evOptimiser";

const EMBER = "#FF6B2C";

export default function PortalEv() {
  const { user } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [prices, setPrices] = useState<PriceSlot[]>([]);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    setClientId(cl.id);
    const { data: v } = await supabase.from("ev_vehicles").select("*").eq("client_id", cl.id).order("created_at");
    setVehicles(v ?? []);
    if (v && v.length && !selectedId) setSelectedId(v[0].id);

    const now = new Date(); now.setMinutes(0, 0, 0);
    const end = new Date(now.getTime() + 36 * 3600e3);
    const { data: mp } = await supabase.from("market_prices")
      .select("delivery_at, price_eur_mwh")
      .gte("delivery_at", now.toISOString()).lte("delivery_at", end.toISOString())
      .order("delivery_at", { ascending: true });
    let curve: PriceSlot[] = (mp ?? []).map(r => ({ ts: r.delivery_at as string, price_eur_mwh: Number(r.price_eur_mwh) }));
    if (curve.length < 12) curve = syntheticPrices(now, 36);
    setPrices(curve);
  };
  useEffect(() => { load(); }, [user]);

  const vehicle = vehicles.find(v => v.id === selectedId);

  const plan = useMemo(() => {
    if (!vehicle) return null;
    const now = new Date();
    const ready = new Date(); const [hh, mm] = (vehicle.ready_by_time || "07:00").split(":").map(Number);
    ready.setHours(hh, mm, 0, 0);
    if (ready <= now) ready.setDate(ready.getDate() + 1);
    return optimiseChargePlan({
      prices, pluggedInAt: now, readyBy: ready,
      batteryKwh: Number(vehicle.battery_kwh), currentSocPct: vehicle.current_soc_pct,
      targetSocPct: vehicle.target_soc_pct, maxChargeKw: Number(vehicle.max_charge_kw),
    });
  }, [vehicle, prices]);

  const chartData = useMemo(() => {
    if (!plan) return [];
    return plan.schedule.map(s => ({
      label: `${String(s.hour).padStart(2,"0")}:${String(s.minute).padStart(2,"0")}`,
      kw: s.kw, price: s.price_eur_mwh,
    }));
  }, [plan]);

  const addVehicle = async (form: FormData) => {
    if (!clientId) return;
    const payload = {
      client_id: clientId,
      nickname: String(form.get("nickname") || "My EV"),
      make: String(form.get("make") || ""),
      model: String(form.get("model") || ""),
      battery_kwh: Number(form.get("battery_kwh") || 60),
      max_charge_kw: Number(form.get("max_charge_kw") || 7),
      current_soc_pct: Number(form.get("current_soc_pct") || 30),
      target_soc_pct: Number(form.get("target_soc_pct") || 80),
      ready_by_time: String(form.get("ready_by_time") || "07:00"),
      plugged_in: true,
    };
    const { error } = await supabase.from("ev_vehicles").insert(payload as any);
    if (error) return toast.error(error.message);
    toast.success("Vehicle added"); setAdding(false); load();
  };

  const update = async (patch: any) => {
    if (!vehicle) return;
    const { error } = await supabase.from("ev_vehicles").update(patch).eq("id", vehicle.id);
    if (error) return toast.error(error.message);
    load();
  };

  const remove = async () => {
    if (!vehicle) return;
    if (!confirm(`Remove ${vehicle.nickname}?`)) return;
    await supabase.from("ev_vehicles").delete().eq("id", vehicle.id);
    setSelectedId(""); load();
  };

  const savePlan = async () => {
    if (!vehicle || !plan || !clientId) return;
    const { error } = await supabase.from("ev_charge_plans").insert({
      vehicle_id: vehicle.id, client_id: clientId,
      plan_for_date: new Date().toISOString().slice(0, 10),
      schedule: plan.schedule as any, est_kwh: plan.estKwh, est_cost_eur: plan.estCostEur,
      avg_price_eur_mwh: plan.avgPriceEurMwh,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Charge plan saved");
  };

  if (vehicles.length === 0 && !adding) return (
    <PortalLayout title="EV smart charging">
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <div className="h-14 w-14 rounded-full grid place-items-center mx-auto" style={{ background: "rgba(255,107,44,0.12)", color: EMBER }}><Car className="h-7 w-7" /></div>
          <div>
            <div className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Charge for less, automatically</div>
            <div className="text-sm text-muted-foreground max-w-md mx-auto mt-1">Add your EV and we'll plan its charge into the cheapest half-hours overnight, ready to drive when you wake up.</div>
          </div>
          <Button onClick={() => setAdding(true)} style={{ background: EMBER, color: "#1A140F" }}><Plus className="h-4 w-4 mr-2" />Add vehicle</Button>
        </CardContent>
      </Card>
    </PortalLayout>
  );

  if (adding) return (
    <PortalLayout title="Add your EV">
      <Card><CardContent className="p-5">
        <form onSubmit={e => { e.preventDefault(); addVehicle(new FormData(e.currentTarget)); }} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field name="nickname" label="Nickname" placeholder="The Tesla" required />
          <div className="grid grid-cols-2 gap-3">
            <Field name="make" label="Make" placeholder="Tesla" />
            <Field name="model" label="Model" placeholder="Model 3" />
          </div>
          <Field name="battery_kwh" label="Battery (kWh)" type="number" defaultValue="60" />
          <Field name="max_charge_kw" label="Max charge (kW)" type="number" defaultValue="7" />
          <Field name="current_soc_pct" label="Current charge (%)" type="number" defaultValue="30" />
          <Field name="target_soc_pct" label="Target charge (%)" type="number" defaultValue="80" />
          <Field name="ready_by_time" label="Ready by" type="time" defaultValue="07:00" />
          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" style={{ background: EMBER, color: "#1A140F" }}>Add vehicle</Button>
          </div>
        </form>
      </CardContent></Card>
    </PortalLayout>
  );

  return (
    <PortalLayout title="EV smart charging">
      {/* Vehicle picker + add */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>{vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.nickname}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>
        {vehicle && <Button variant="ghost" size="sm" onClick={remove}><Trash2 className="h-4 w-4 mr-1" />Remove</Button>}
      </div>

      {vehicle && (
        <>
          {/* Vehicle controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card><CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-widest">Vehicle</div>
                  <div className="text-lg font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{vehicle.nickname}</div>
                  <div className="text-xs text-muted-foreground">{[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"} · {vehicle.battery_kwh} kWh</div>
                </div>
                <Badge variant="outline" style={{ color: vehicle.plugged_in ? EMBER : undefined, borderColor: vehicle.plugged_in ? `${EMBER}55` : undefined }}>
                  <Plug className="h-3 w-3 mr-1" />{vehicle.plugged_in ? "Plugged in" : "Unplugged"}
                </Badge>
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => update({ plugged_in: !vehicle.plugged_in })}>
                {vehicle.plugged_in ? "Mark unplugged" : "Mark plugged in"}
              </Button>
            </CardContent></Card>

            <Card><CardContent className="p-4 space-y-3">
              <div className="text-xs text-muted-foreground uppercase tracking-widest">Current charge</div>
              <div className="text-3xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: EMBER }}>{vehicle.current_soc_pct}%</div>
              <Slider value={[vehicle.current_soc_pct]} min={0} max={100} step={5} onValueChange={v => update({ current_soc_pct: v[0] })} />
            </CardContent></Card>

            <Card><CardContent className="p-4 space-y-3">
              <div className="text-xs text-muted-foreground uppercase tracking-widest">Target & ready time</div>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-semibold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{vehicle.target_soc_pct}%</div>
                <Input type="time" defaultValue={vehicle.ready_by_time?.slice(0,5) ?? "07:00"} className="w-32"
                       onBlur={e => update({ ready_by_time: e.target.value })} />
              </div>
              <Slider value={[vehicle.target_soc_pct]} min={20} max={100} step={5} onValueChange={v => update({ target_soc_pct: v[0] })} />
            </CardContent></Card>
          </div>

          {/* Plan summary */}
          {plan && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi icon={BatteryCharging} label="Energy to add" value={`${fmtNum(plan.estKwh)} kWh`} />
              <Kpi icon={Zap} label="Estimated cost" value={`€${fmtNum(plan.estCostEur)}`} />
              <Kpi icon={Sparkles} label="Avg price" value={`€${fmtNum(plan.avgPriceEurMwh)}/MWh`} />
              <Kpi icon={Car} label="Charging slots" value={`${plan.schedule.filter(s => s.kw > 0).length}`} sub="of 30-min slots" />
            </div>
          )}

          {/* Chart */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" style={{ color: EMBER }} /> Smart charge plan</CardTitle>
              <Button size="sm" variant="outline" onClick={savePlan}>Save plan</Button>
            </CardHeader>
            <CardContent className="h-80">
              {chartData.length === 0 ? (
                <div className="h-full grid place-items-center text-sm text-muted-foreground">No window — set a future ready-by time.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                    <XAxis dataKey="label" fontSize={10} interval={3} stroke="hsl(var(--muted-foreground))" />
                    <YAxis yAxisId="kw" fontSize={11} stroke="hsl(var(--muted-foreground))" label={{ value: "kW", angle: -90, position: "insideLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="price" orientation="right" fontSize={11} stroke="hsl(var(--muted-foreground))" label={{ value: "€/MWh", angle: 90, position: "insideRight", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ background: "#1A140F", border: "1px solid #3A3128", borderRadius: 8, fontSize: 12 }} />
                    <Bar yAxisId="kw" dataKey="kw" name="Charging (kW)" fill={EMBER} radius={[2,2,0,0]} />
                    <Line yAxisId="price" type="monotone" dataKey="price" name="Price (€/MWh)" stroke="#7FB3FF" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PortalLayout>
  );
}

function Field({ label, name, ...rest }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input name={name} {...rest} />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="h-7 w-7 rounded-md grid place-items-center" style={{ background: "rgba(255,107,44,0.12)", color: EMBER }}><Icon className="h-3.5 w-3.5" /></div>
      </div>
      <div className="text-2xl font-semibold mt-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </CardContent></Card>
  );
}