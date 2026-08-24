import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Battery, Sun, Zap, MapPin, Radio, Link2, AlertTriangle, Pencil, Calculator } from "lucide-react";

type Site = { id: string; name: string; address: string | null; country: string | null; metering_point_id: string | null; latitude: number | null; longitude: number | null };
type Asset = {
  id: string; site_id: string; asset_code: string; asset_type: "bess" | "pv" | "hybrid";
  vendor: string | null; model: string | null; nameplate_power_kw: number | null;
  nameplate_energy_kwh: number | null; pv_dc_kwp: number | null; status: string;
  gateway_device_id: number | null;
  usable_energy_kwh: number | null;
  charge_efficiency: number | null; discharge_efficiency: number | null;
  soc_min_pct: number | null; soc_max_pct: number | null; soc_terminal_pct: number | null;
  max_cycles_per_day: number | null;
  grid_import_limit_kw: number | null; grid_export_limit_kw: number | null;
  degradation_eur_per_mwh: number | null;
};
type Meter = { id: string; edu_code: string };

const PAGE = 1000;

const emptyAsset = {
  site_id: "", asset_code: "", asset_type: "bess", vendor: "", model: "",
  nameplate_power_kw: "", nameplate_energy_kwh: "", pv_dc_kwp: "", gateway_device_id: "",
  usable_energy_kwh: "", charge_efficiency: "0.938", discharge_efficiency: "0.938",
  soc_min_pct: "10", soc_max_pct: "95", soc_terminal_pct: "50", max_cycles_per_day: "1.5",
  grid_import_limit_kw: "", grid_export_limit_kw: "", degradation_eur_per_mwh: "",
};

const num = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));
const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** capex / (usable MWh x warranty cycles x 2) — cost of one MWh throughput */
export function degradationCost(capexEur: number, usableKwh: number, cycles: number): number | null {
  const mwh = usableKwh / 1000;
  if (!(capexEur > 0) || !(mwh > 0) || !(cycles > 0)) return null;
  return capexEur / (mwh * cycles * 2);
}

export default function Assets() {
  const { user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteOpen, setSiteOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState<any>({ name: "", address: "", country: "", metering_point_id: "", latitude: "", longitude: "" });
  const [assetForm, setAssetForm] = useState<any>({ ...emptyAsset });
  const [linkAsset, setLinkAsset] = useState<Asset | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [capex, setCapex] = useState("");
  const [cycles, setCycles] = useState("6000");

  async function load() {
    setLoading(true);
    const [s, a, m] = await Promise.all([
      supabase.from("sites").select("*").order("name").range(0, PAGE - 1),
      supabase.from("assets").select("*").order("asset_code").range(0, PAGE - 1),
      supabase.from("metering_points").select("id, edu_code").order("edu_code").range(0, PAGE - 1),
    ]);
    setSites((s.data ?? []) as any);
    setAssets((a.data ?? []) as any);
    setMeters((m.data ?? []) as any);
    setLoading(false);
  }
  useEffect(() => { if (user) load(); }, [user]);

  async function saveSite() {
    if (!user || !siteForm.name) return;
    const { error } = await supabase.from("sites").insert({
      name: siteForm.name,
      address: siteForm.address || null,
      country: siteForm.country || null,
      metering_point_id: siteForm.metering_point_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Site added");
    setSiteOpen(false);
    setSiteForm({ name: "", address: "", country: "", metering_point_id: "" });
    load();
  }

  const isStorage = assetForm.asset_type === "bess" || assetForm.asset_type === "hybrid";

  const computedDegradation = useMemo(
    () => degradationCost(Number(capex || 0), Number(assetForm.usable_energy_kwh || assetForm.nameplate_energy_kwh || 0), Number(cycles || 0)),
    [capex, cycles, assetForm.usable_energy_kwh, assetForm.nameplate_energy_kwh],
  );

  function openCreate() {
    setEditId(null);
    setAssetForm({ ...emptyAsset });
    setCapex(""); setCycles("6000");
    setAssetOpen(true);
  }

  function openEdit(a: Asset) {
    setEditId(a.id);
    setAssetForm({
      site_id: a.site_id, asset_code: a.asset_code, asset_type: a.asset_type,
      vendor: a.vendor ?? "", model: a.model ?? "",
      nameplate_power_kw: str(a.nameplate_power_kw), nameplate_energy_kwh: str(a.nameplate_energy_kwh),
      pv_dc_kwp: str(a.pv_dc_kwp), gateway_device_id: str(a.gateway_device_id),
      usable_energy_kwh: str(a.usable_energy_kwh),
      charge_efficiency: str(a.charge_efficiency), discharge_efficiency: str(a.discharge_efficiency),
      soc_min_pct: str(a.soc_min_pct), soc_max_pct: str(a.soc_max_pct), soc_terminal_pct: str(a.soc_terminal_pct),
      max_cycles_per_day: str(a.max_cycles_per_day),
      grid_import_limit_kw: str(a.grid_import_limit_kw), grid_export_limit_kw: str(a.grid_export_limit_kw),
      degradation_eur_per_mwh: str(a.degradation_eur_per_mwh),
    });
    setCapex(""); setCycles("6000");
    setAssetOpen(true);
  }

  async function saveAsset() {
    if (!user || !assetForm.site_id || !assetForm.asset_code) return toast.error("Site and asset code are required");
    const gw = String(assetForm.gateway_device_id ?? "").trim();
    if (gw && !/^\d+$/.test(gw)) return toast.error("Gateway device ID must be a whole number");

    const payload: any = {
      site_id: assetForm.site_id,
      asset_code: assetForm.asset_code,
      asset_type: assetForm.asset_type,
      vendor: assetForm.vendor || null,
      model: assetForm.model || null,
      nameplate_power_kw: num(assetForm.nameplate_power_kw),
      nameplate_energy_kwh: num(assetForm.nameplate_energy_kwh),
      pv_dc_kwp: num(assetForm.pv_dc_kwp),
      gateway_device_id: gw ? Number(gw) : null,
      usable_energy_kwh: num(assetForm.usable_energy_kwh),
      grid_import_limit_kw: num(assetForm.grid_import_limit_kw),
      grid_export_limit_kw: num(assetForm.grid_export_limit_kw),
      degradation_eur_per_mwh: num(assetForm.degradation_eur_per_mwh),
    };
    // NOT NULL columns with DB defaults — only send when a value is present
    for (const k of ["charge_efficiency", "discharge_efficiency", "soc_min_pct", "soc_max_pct", "soc_terminal_pct", "max_cycles_per_day"]) {
      const v = num(assetForm[k]);
      if (v !== null) payload[k] = v;
    }

    const { error } = editId
      ? await supabase.from("assets").update(payload).eq("id", editId)
      : await supabase.from("assets").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editId ? "Asset updated" : "Asset added");
    setAssetOpen(false);
    setEditId(null);
    setAssetForm({ ...emptyAsset });
    load();
  }

  function openLink(a: Asset) {
    setLinkAsset(a);
    setLinkValue(a.gateway_device_id != null ? String(a.gateway_device_id) : "");
  }

  async function saveLink() {
    if (!linkAsset) return;
    const raw = linkValue.trim();
    if (raw && !/^\d+$/.test(raw)) return toast.error("Device ID must be a number");
    setLinkSaving(true);
    const { error } = await supabase.from("assets").update({ gateway_device_id: raw ? Number(raw) : null }).eq("id", linkAsset.id);
    setLinkSaving(false);
    if (error) return toast.error(error.message);
    toast.success(raw ? "Gateway device linked" : "Gateway link removed");
    setLinkAsset(null);
    load();
  }

  function gaps(a: Asset): string[] {
    const out: string[] = [];
    if (a.gateway_device_id == null) out.push("No gateway device ID — telemetry sync and EMS plan push skip this asset.");
    if ((a.asset_type === "bess" || a.asset_type === "hybrid")) {
      if (a.degradation_eur_per_mwh == null) out.push("No degradation cost — the BESS optimizer refuses to run.");
      if (a.usable_energy_kwh == null) out.push("No usable energy — optimizer falls back to nameplate energy.");
    }
    return out;
  }

  const typeIcon = (t: string) => t === "pv" ? <Sun className="h-3.5 w-3.5" /> : t === "hybrid" ? <Zap className="h-3.5 w-3.5" /> : <Battery className="h-3.5 w-3.5" />;

  return (
    <ErpLayout title="Assets — BESS & PV" subtitle="Sites and storage / generation assets">
      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Sites</CardTitle>
            <Dialog open={siteOpen} onOpenChange={setSiteOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add site</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New site</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div><Label>Name</Label><Input value={siteForm.name} onChange={e => setSiteForm({ ...siteForm, name: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Country</Label><Input value={siteForm.country} onChange={e => setSiteForm({ ...siteForm, country: e.target.value })} /></div>
                    <div><Label>Address</Label><Input value={siteForm.address} onChange={e => setSiteForm({ ...siteForm, address: e.target.value })} /></div>
                  </div>
                  <div>
                    <Label>Linked metering point (optional, BTM)</Label>
                    <Select value={siteForm.metering_point_id} onValueChange={v => setSiteForm({ ...siteForm, metering_point_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Standalone / no link" /></SelectTrigger>
                      <SelectContent>
                        {meters.map(m => <SelectItem key={m.id} value={m.id}>{m.edu_code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter><Button onClick={saveSite}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Country</TableHead><TableHead>Address</TableHead><TableHead>Link</TableHead><TableHead>Assets</TableHead></TableRow></TableHeader>
              <TableBody>
                {sites.map(s => {
                  const mp = meters.find(m => m.id === s.metering_point_id);
                  const count = assets.filter(a => a.site_id === s.id).length;
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.country || "—"}</TableCell>
                      <TableCell>{s.address || "—"}</TableCell>
                      <TableCell>{mp ? <Badge variant="outline">BTM · {mp.edu_code}</Badge> : <Badge variant="secondary">Standalone</Badge>}</TableCell>
                      <TableCell>{count}</TableCell>
                    </TableRow>
                  );
                })}
                {!loading && sites.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No sites yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Battery className="h-4 w-4" /> Assets</CardTitle>
            <Button size="sm" disabled={sites.length === 0} onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Add asset</Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead><TableHead>Type</TableHead><TableHead>Site</TableHead>
                <TableHead className="text-right">Power kW</TableHead><TableHead className="text-right">Usable kWh</TableHead>
                <TableHead className="text-right">SoC band</TableHead><TableHead className="text-right">Degr. €/MWh</TableHead>
                <TableHead>Gateway</TableHead><TableHead>Readiness</TableHead><TableHead className="text-right">Edit</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {assets.map(a => {
                  const site = sites.find(s => s.id === a.site_id);
                  const issues = gaps(a);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.asset_code}</TableCell>
                      <TableCell><Badge variant="outline" className="gap-1">{typeIcon(a.asset_type)}{a.asset_type.toUpperCase()}</Badge></TableCell>
                      <TableCell>{site?.name || "—"}</TableCell>
                      <TableCell className="text-right">{a.nameplate_power_kw ?? "—"}</TableCell>
                      <TableCell className="text-right">{a.usable_energy_kwh ?? a.nameplate_energy_kwh ?? "—"}</TableCell>
                      <TableCell className="text-right">{a.soc_min_pct != null && a.soc_max_pct != null ? `${a.soc_min_pct}–${a.soc_max_pct}%` : "—"}</TableCell>
                      <TableCell className="text-right">{a.degradation_eur_per_mwh != null ? Number(a.degradation_eur_per_mwh).toFixed(2) : "—"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => openLink(a)}>
                          {a.gateway_device_id != null
                            ? <Badge variant="outline" className="gap-1"><Radio className="h-3 w-3" />#{a.gateway_device_id}</Badge>
                            : <span className="text-muted-foreground flex items-center gap-1 text-xs"><Link2 className="h-3 w-3" />Not linked</span>}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {issues.length === 0 ? (
                          <Badge variant="secondary">Ready</Badge>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="destructive" className="gap-1 cursor-help"><AlertTriangle className="h-3 w-3" />{issues.length} issue{issues.length > 1 ? "s" : ""}</Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <ul className="list-disc pl-4 space-y-1 text-xs">{issues.map(i => <li key={i}>{i}</li>)}</ul>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && assets.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No assets yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={assetOpen} onOpenChange={o => { setAssetOpen(o); if (!o) setEditId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit asset" : "New asset"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Site</Label>
                <Select value={assetForm.site_id} onValueChange={v => setAssetForm({ ...assetForm, site_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select value={assetForm.asset_type} onValueChange={v => setAssetForm({ ...assetForm, asset_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bess">BESS</SelectItem>
                    <SelectItem value="pv">PV</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Asset code</Label><Input value={assetForm.asset_code} onChange={e => setAssetForm({ ...assetForm, asset_code: e.target.value })} /></div>
              <div><Label>Vendor</Label><Input value={assetForm.vendor} onChange={e => setAssetForm({ ...assetForm, vendor: e.target.value })} /></div>
              <div><Label>Model</Label><Input value={assetForm.model} onChange={e => setAssetForm({ ...assetForm, model: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Power (kW)</Label><Input type="number" value={assetForm.nameplate_power_kw} onChange={e => setAssetForm({ ...assetForm, nameplate_power_kw: e.target.value })} /></div>
              <div><Label>Nameplate energy (kWh)</Label><Input type="number" value={assetForm.nameplate_energy_kwh} onChange={e => setAssetForm({ ...assetForm, nameplate_energy_kwh: e.target.value })} placeholder="BESS only" /></div>
              <div><Label>PV DC (kWp)</Label><Input type="number" value={assetForm.pv_dc_kwp} onChange={e => setAssetForm({ ...assetForm, pv_dc_kwp: e.target.value })} placeholder="PV only" /></div>
            </div>

            <div>
              <Label>Gateway device ID</Label>
              <Input type="number" value={assetForm.gateway_device_id ?? ""} onChange={e => setAssetForm({ ...assetForm, gateway_device_id: e.target.value })} placeholder="Numeric device ID from VoltTrade Cloud gateway" />
              <p className="text-xs text-muted-foreground mt-1">Required for telemetry sync and EMS plan push — assets without it are skipped by both.</p>
            </div>

            {isStorage && (
              <>
                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-2">Storage / optimizer parameters</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Usable energy (kWh)</Label><Input type="number" value={assetForm.usable_energy_kwh} onChange={e => setAssetForm({ ...assetForm, usable_energy_kwh: e.target.value })} /></div>
                    <div><Label>Charge eff.</Label><Input type="number" step="0.001" value={assetForm.charge_efficiency} onChange={e => setAssetForm({ ...assetForm, charge_efficiency: e.target.value })} /></div>
                    <div><Label>Discharge eff.</Label><Input type="number" step="0.001" value={assetForm.discharge_efficiency} onChange={e => setAssetForm({ ...assetForm, discharge_efficiency: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 mt-3">
                    <div><Label>SoC min %</Label><Input type="number" value={assetForm.soc_min_pct} onChange={e => setAssetForm({ ...assetForm, soc_min_pct: e.target.value })} /></div>
                    <div><Label>SoC max %</Label><Input type="number" value={assetForm.soc_max_pct} onChange={e => setAssetForm({ ...assetForm, soc_max_pct: e.target.value })} /></div>
                    <div><Label>SoC terminal %</Label><Input type="number" value={assetForm.soc_terminal_pct} onChange={e => setAssetForm({ ...assetForm, soc_terminal_pct: e.target.value })} /></div>
                    <div><Label>Max cycles / day</Label><Input type="number" step="0.1" value={assetForm.max_cycles_per_day} onChange={e => setAssetForm({ ...assetForm, max_cycles_per_day: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div><Label>Grid import limit (kW)</Label><Input type="number" value={assetForm.grid_import_limit_kw} onChange={e => setAssetForm({ ...assetForm, grid_import_limit_kw: e.target.value })} /></div>
                    <div><Label>Grid export limit (kW)</Label><Input type="number" value={assetForm.grid_export_limit_kw} onChange={e => setAssetForm({ ...assetForm, grid_export_limit_kw: e.target.value })} /></div>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-2 flex items-center gap-2"><Calculator className="h-4 w-4" /> Degradation cost (€/MWh throughput)</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Battery capex (€)</Label><Input type="number" value={capex} onChange={e => setCapex(e.target.value)} /></div>
                    <div><Label>Warranty cycles</Label><Input type="number" value={cycles} onChange={e => setCycles(e.target.value)} /></div>
                    <div><Label>Degradation €/MWh</Label><Input type="number" step="0.01" value={assetForm.degradation_eur_per_mwh} onChange={e => setAssetForm({ ...assetForm, degradation_eur_per_mwh: e.target.value })} /></div>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <p className="text-xs text-muted-foreground flex-1">
                      capex / (usable MWh × cycles × 2){computedDegradation != null ? ` = ${computedDegradation.toFixed(2)} €/MWh` : " — enter capex, usable energy and cycles"}
                    </p>
                    <Button type="button" variant="outline" size="sm" disabled={computedDegradation == null}
                      onClick={() => setAssetForm({ ...assetForm, degradation_eur_per_mwh: computedDegradation!.toFixed(2) })}>
                      Use computed
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">The BESS optimizer refuses to run without this value.</p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetOpen(false)}>Cancel</Button>
            <Button onClick={saveAsset}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linkAsset} onOpenChange={o => !o && setLinkAsset(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Gateway device link — {linkAsset?.asset_code}</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <Label>Device ID</Label>
            <Input type="number" value={linkValue} onChange={e => setLinkValue(e.target.value)} placeholder="e.g. 1042" />
            <p className="text-xs text-muted-foreground">
              Once linked, telemetry sync pulls SoC / power / alarms for this asset and EMS dispatch plans are pushed to the device. Leave empty to unlink.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkAsset(null)}>Cancel</Button>
            <Button onClick={saveLink} disabled={linkSaving}>{linkSaving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}
