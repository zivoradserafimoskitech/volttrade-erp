import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Battery, Sun, Zap, MapPin } from "lucide-react";

type Site = { id: string; name: string; address: string | null; country: string | null; metering_point_id: string | null };
type Asset = {
  id: string; site_id: string; asset_code: string; asset_type: "bess" | "pv" | "hybrid";
  vendor: string | null; model: string | null; nameplate_power_kw: number | null;
  nameplate_energy_kwh: number | null; pv_dc_kwp: number | null; external_ref: string | null; status: string;
};
type Meter = { id: string; edu_code: string };

export default function Assets() {
  const { user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteOpen, setSiteOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [siteForm, setSiteForm] = useState<any>({ name: "", address: "", country: "", metering_point_id: "" });
  const [assetForm, setAssetForm] = useState<any>({ site_id: "", asset_code: "", asset_type: "bess", vendor: "", model: "", nameplate_power_kw: "", nameplate_energy_kwh: "", pv_dc_kwp: "", external_ref: "" });

  async function load() {
    setLoading(true);
    const [s, a, m] = await Promise.all([
      supabase.from("sites").select("*").order("name"),
      supabase.from("assets").select("*").order("asset_code"),
      supabase.from("metering_points").select("id, edu_code"),
    ]);
    setSites((s.data ?? []) as any);
    setAssets((a.data ?? []) as any);
    setMeters((m.data ?? []) as any);
    setLoading(false);
  }
  useEffect(() => { if (user) load(); }, [user]);

  async function saveSite() {
    if (!user || !siteForm.name) return;
    const payload = {
      user_id: user.id,
      name: siteForm.name,
      address: siteForm.address || null,
      country: siteForm.country || null,
      metering_point_id: siteForm.metering_point_id || null,
    };
    const { error } = await supabase.from("sites").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Site added");
    setSiteOpen(false);
    setSiteForm({ name: "", address: "", country: "", metering_point_id: "" });
    load();
  }

  async function saveAsset() {
    if (!user || !assetForm.site_id || !assetForm.asset_code) return;
    const payload: any = {
      user_id: user.id,
      site_id: assetForm.site_id,
      asset_code: assetForm.asset_code,
      asset_type: assetForm.asset_type,
      vendor: assetForm.vendor || null,
      model: assetForm.model || null,
      nameplate_power_kw: assetForm.nameplate_power_kw ? Number(assetForm.nameplate_power_kw) : null,
      nameplate_energy_kwh: assetForm.nameplate_energy_kwh ? Number(assetForm.nameplate_energy_kwh) : null,
      pv_dc_kwp: assetForm.pv_dc_kwp ? Number(assetForm.pv_dc_kwp) : null,
      external_ref: assetForm.external_ref || null,
    };
    const { error } = await supabase.from("assets").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Asset added");
    setAssetOpen(false);
    setAssetForm({ site_id: "", asset_code: "", asset_type: "bess", vendor: "", model: "", nameplate_power_kw: "", nameplate_energy_kwh: "", pv_dc_kwp: "", external_ref: "" });
    load();
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
            <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
              <DialogTrigger asChild><Button size="sm" disabled={sites.length === 0}><Plus className="h-4 w-4 mr-1" />Add asset</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New asset</DialogTitle></DialogHeader>
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
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Asset code</Label><Input value={assetForm.asset_code} onChange={e => setAssetForm({ ...assetForm, asset_code: e.target.value })} /></div>
                    <div><Label>External ref (Influx tag)</Label><Input value={assetForm.external_ref} onChange={e => setAssetForm({ ...assetForm, external_ref: e.target.value })} placeholder="defaults to asset code" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Vendor</Label><Input value={assetForm.vendor} onChange={e => setAssetForm({ ...assetForm, vendor: e.target.value })} /></div>
                    <div><Label>Model</Label><Input value={assetForm.model} onChange={e => setAssetForm({ ...assetForm, model: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Power (kW)</Label><Input type="number" value={assetForm.nameplate_power_kw} onChange={e => setAssetForm({ ...assetForm, nameplate_power_kw: e.target.value })} /></div>
                    <div><Label>Energy (kWh)</Label><Input type="number" value={assetForm.nameplate_energy_kwh} onChange={e => setAssetForm({ ...assetForm, nameplate_energy_kwh: e.target.value })} placeholder="BESS only" /></div>
                    <div><Label>PV DC (kWp)</Label><Input type="number" value={assetForm.pv_dc_kwp} onChange={e => setAssetForm({ ...assetForm, pv_dc_kwp: e.target.value })} placeholder="PV only" /></div>
                  </div>
                </div>
                <DialogFooter><Button onClick={saveAsset}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Type</TableHead><TableHead>Site</TableHead><TableHead>Vendor / Model</TableHead><TableHead className="text-right">Power kW</TableHead><TableHead className="text-right">Energy kWh</TableHead><TableHead className="text-right">PV kWp</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {assets.map(a => {
                  const site = sites.find(s => s.id === a.site_id);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.asset_code}</TableCell>
                      <TableCell><Badge variant="outline" className="gap-1">{typeIcon(a.asset_type)}{a.asset_type.toUpperCase()}</Badge></TableCell>
                      <TableCell>{site?.name || "—"}</TableCell>
                      <TableCell>{[a.vendor, a.model].filter(Boolean).join(" / ") || "—"}</TableCell>
                      <TableCell className="text-right">{a.nameplate_power_kw ?? "—"}</TableCell>
                      <TableCell className="text-right">{a.nameplate_energy_kwh ?? "—"}</TableCell>
                      <TableCell className="text-right">{a.pv_dc_kwp ?? "—"}</TableCell>
                      <TableCell><Badge variant={a.status === "active" ? "default" : "secondary"}>{a.status}</Badge></TableCell>
                    </TableRow>
                  );
                })}
                {!loading && assets.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No assets yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ErpLayout>
  );
}