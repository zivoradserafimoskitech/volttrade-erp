import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Plus, Trash2, Zap, Sun } from "lucide-react";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";

type Client = { id: string; company_name: string; tax_id: string | null; contact_name: string | null; contact_email: string | null; contract_type: string; fixed_price_eur_mwh: number | null; margin_eur_mwh: number; status: string };
type Edu = { id: string; client_id: string; edu_code: string; address: string | null; voltage_level: string | null; annual_consumption_mwh: number | null; has_pv?: boolean; pv_capacity_kw?: number | null };
type SlpProfile = { code: string; name: string };

export default function Clients() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [edus, setEdus] = useState<Edu[]>([]);
  const [slpProfiles, setSlpProfiles] = useState<SlpProfile[]>([]);
  const [eduCategory, setEduCategory] = useState<string>("smart_hourly");
  const [openClient, setOpenClient] = useState(false);
  const [openEdu, setOpenEdu] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const { data: cs } = await supabase.from("clients").select("*").order("company_name");
    const { data: es } = await supabase.from("metering_points").select("*").order("edu_code");
    const { data: sp } = await supabase.from("slp_profiles").select("code,name").order("name");
    setClients((cs as any) ?? []);
    setEdus((es as any) ?? []);
    setSlpProfiles((sp as any) ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const addClient = async (form: FormData) => {
    const payload: any = {
      user_id: user!.id,
      company_name: form.get("company_name"),
      tax_id: form.get("tax_id") || null,
      contact_name: form.get("contact_name") || null,
      contact_email: form.get("contact_email") || null,
      contact_phone: form.get("contact_phone") || null,
      contract_type: form.get("contract_type"),
      fixed_price_eur_mwh: form.get("fixed_price_eur_mwh") ? Number(form.get("fixed_price_eur_mwh")) : null,
      margin_eur_mwh: Number(form.get("margin_eur_mwh") || 3.5),
    };
    const { error } = await supabase.from("clients").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Client added"); setOpenClient(false); load();
  };

  const addEdu = async (form: FormData, client_id: string) => {
    const category = String(form.get("consumer_category") || "smart_hourly");
    const power = form.get("connected_power_kw") ? Number(form.get("connected_power_kw")) : null;
    const slpCode = form.get("slp_profile_code") ? String(form.get("slp_profile_code")) : null;
    if (category === "slp" && !slpCode) return toast.error("Pick an SLP profile for category ≤ 40 kW");
    const { error } = await supabase.from("metering_points").insert({
      client_id,
      edu_code: String(form.get("edu_code")),
      address: form.get("address") || null,
      voltage_level: form.get("voltage_level") || null,
      annual_consumption_mwh: form.get("annual_consumption_mwh") ? Number(form.get("annual_consumption_mwh")) : null,
      consumer_category: category,
      connected_power_kw: power,
      slp_profile_code: category === "slp" ? slpCode : null,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Metering point added"); setOpenEdu(null); setEduCategory("smart_hourly"); load();
  };

  const removeClient = async (id: string) => {
    if (!confirm("Delete this client and all related EDUs?")) return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <ErpLayout title="Client Management (CRM)" subtitle="Business clients, contracts and metering points (EDU)"
      actions={
        <Dialog open={openClient} onOpenChange={setOpenClient}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />Add client</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); addClient(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <Field name="company_name" label="Company name" required className="col-span-2" />
              <Field name="tax_id" label="Tax ID / VAT" />
              <Field name="contact_name" label="Contact name" />
              <Field name="contact_email" label="Email" type="email" />
              <Field name="contact_phone" label="Phone" />
              <div className="space-y-2">
                <Label>Contract type</Label>
                <Select name="contract_type" defaultValue="fixed">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed price</SelectItem>
                    <SelectItem value="market">Market-indexed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field name="fixed_price_eur_mwh" label="Fixed price (€/MWh)" type="number" step="0.01" />
              <Field name="margin_eur_mwh" label="Margin (€/MWh)" type="number" step="0.01" defaultValue="3.50" />
              <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Save client</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <Card className="border-border/60">
        <CardHeader><CardTitle>Clients ({clients.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Tax ID</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead className="text-right">Margin (€/MWh)</TableHead>
                <TableHead>EDUs</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map(c => {
                const myEdus = edus.filter(e => e.client_id === c.id);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.company_name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.tax_id ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.contact_name ?? "—"}<div className="text-xs">{c.contact_email}</div></TableCell>
                    <TableCell><Badge variant={c.contract_type === "fixed" ? "secondary" : "default"} className={c.contract_type === "market" ? "bg-accent/20 text-accent border-accent/30" : ""}>{c.contract_type === "fixed" ? `Fixed ${c.fixed_price_eur_mwh ?? "?"} €` : "Market"}</Badge></TableCell>
                    <TableCell className="text-right">{fmtNum(c.margin_eur_mwh)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        {myEdus.map((e: any) => (
                          <Badge key={e.id} variant="outline" className="font-mono text-[10px]" title={e.consumer_category === 'slp' ? `SLP: ${e.slp_profile_code ?? '—'}` : e.consumer_category}>
                            <Zap className="h-3 w-3 mr-1" />{e.edu_code}
                            <span className="ml-1 opacity-60">· {e.consumer_category === 'slp' ? 'SLP' : e.consumer_category === 'smart_daily' ? 'D' : 'H'}</span>
                          </Badge>
                        ))}
                        <Dialog open={openEdu === c.id} onOpenChange={(o) => { setOpenEdu(o ? c.id : null); if (!o) setEduCategory("smart_hourly"); }}>
                          <DialogTrigger asChild><Button size="sm" variant="ghost" className="h-6 px-2 text-xs">+ Add EDU</Button></DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>New metering point</DialogTitle></DialogHeader>
                            <form onSubmit={e => { e.preventDefault(); addEdu(new FormData(e.currentTarget), c.id); }} className="grid grid-cols-2 gap-3">
                              <Field name="edu_code" label="EDU code" required placeholder="HU000120F11-U-XXXXXX" />
                              <Field name="connected_power_kw" label="Connected power (kW)" type="number" step="0.1" />
                              <Field name="address" label="Address" className="col-span-2" />
                              <Field name="voltage_level" label="Voltage level" placeholder="LV / MV / HV" />
                              <Field name="annual_consumption_mwh" label="Annual consumption (MWh)" type="number" step="0.01" />
                              <div className="space-y-2 col-span-2">
                                <Label>Consumer category</Label>
                                <Select name="consumer_category" value={eduCategory} onValueChange={setEduCategory}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="slp">SLP profile (≤ 40 kW, direct meter)</SelectItem>
                                    <SelectItem value="smart_daily">Smart meter — daily readings (&gt; 40 kW)</SelectItem>
                                    <SelectItem value="smart_hourly">Smart meter — hourly readings</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {eduCategory === "slp" && (
                                <div className="space-y-2 col-span-2">
                                  <Label>Standard load profile</Label>
                                  <Select name="slp_profile_code">
                                    <SelectTrigger><SelectValue placeholder="Pick a profile…" /></SelectTrigger>
                                    <SelectContent>
                                      {slpProfiles.map(p => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              <DialogFooter className="col-span-2"><Button type="submit">Save</Button></DialogFooter>
                            </form>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </TableCell>
                    <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => removeClient(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                );
              })}
              {clients.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">No clients yet. Click "Add client" to get started.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ErpLayout>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...rest } = props;
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label htmlFor={rest.name}>{label}</Label>
      <Input id={rest.name} {...rest} />
    </div>
  );
}