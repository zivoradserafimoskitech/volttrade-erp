import { useEffect, useMemo, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Upload, FileText, CheckCircle2, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format";

const STAGES = [
  { key: "lead", label: "Lead", color: "bg-slate-500" },
  { key: "qualified", label: "Qualified", color: "bg-blue-500" },
  { key: "quote", label: "Quote", color: "bg-amber-500" },
  { key: "contract_sent", label: "Contract sent", color: "bg-violet-500" },
  { key: "kyc", label: "KYC", color: "bg-orange-500" },
  { key: "activated", label: "Activated", color: "bg-emerald-600" },
  { key: "lost", label: "Lost", color: "bg-rose-600" },
];
const DOC_TYPES = [
  { v: "company_reg", l: "Company registration" },
  { v: "signatory_id", l: "Signatory ID" },
  { v: "proof_address", l: "Proof of address" },
  { v: "previous_invoice", l: "Previous invoice" },
  { v: "other", l: "Other" },
];

export default function Onboarding() {
  return (
    <ErpLayout title="Customer Onboarding" subtitle="Lead → Qualified → Quote → Contract → KYC → Activated">
      <RoleGate roles={["admin", "management", "supply_manager"]}>
        <Inner />
      </RoleGate>
    </ErpLayout>
  );
}

function Inner() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<any[]>([]);
  const [tariffs, setTariffs] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<any>(null);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);

  const load = async () => {
    const [l, t] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("tariffs").select("id,code,name,components,currency").order("code"),
    ]);
    setLeads(l.data ?? []);
    setTariffs(t.data ?? []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const loadDetail = async (leadId: string) => {
    const [q, d] = await Promise.all([
      supabase.from("lead_quotes").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
      supabase.from("kyc_documents").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
    ]);
    setQuotes(q.data ?? []); setDocs(d.data ?? []);
  };

  const openLead = async (l: any) => { setPicked(l); await loadDetail(l.id); };

  const addLead = async (form: FormData) => {
    const { error } = await supabase.from("leads").insert({
      user_id: user!.id,
      company_name: String(form.get("company_name")),
      contact_name: form.get("contact_name") as string || null,
      contact_email: form.get("contact_email") as string || null,
      contact_phone: form.get("contact_phone") as string || null,
      country: form.get("country") as string || null,
      source: form.get("source") as string || null,
      owner: form.get("owner") as string || null,
      est_annual_mwh: Number(form.get("est_annual_mwh") || 0),
      est_value_eur: Number(form.get("est_value_eur") || 0),
      stage: "lead",
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Lead created"); setOpen(false); load();
  };

  const moveStage = async (leadId: string, stage: string) => {
    const upd: any = { stage };
    if (stage === "lost") upd.lost_reason = prompt("Lost reason?") ?? null;
    const { error } = await supabase.from("leads").update(upd).eq("id", leadId);
    if (error) return toast.error(error.message);
    load(); if (picked?.id === leadId) setPicked({ ...picked, ...upd });
  };

  const addQuote = async (form: FormData) => {
    if (!picked) return;
    const tariff_id = String(form.get("tariff_id")) || null;
    const pickTariff = tariffs.find(x => x.id === tariff_id);
    const energyComp = Array.isArray(pickTariff?.components) ? pickTariff!.components.find((c: any) => c.type === "energy") : null;
    const base = Number(energyComp?.value ?? 0);
    const margin = Number(form.get("margin_eur_mwh") || 0);
    const vol = Number(form.get("annual_volume_mwh") || picked.est_annual_mwh || 0);
    const annual_cost_eur = (Number(base) + margin) * vol;
    const { error } = await supabase.from("lead_quotes").insert({
      lead_id: picked.id, tariff_id,
      term_months: Number(form.get("term_months") || 12),
      base_price_eur_mwh: base, margin_eur_mwh: margin,
      annual_volume_mwh: vol, annual_cost_eur, status: "draft",
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Quote drafted"); loadDetail(picked.id);
  };

  const uploadDoc = async (file: File, doc_type: string) => {
    if (!picked) return;
    const path = `${picked.id}/${Date.now()}_${file.name}`;
    const up = await supabase.storage.from("kyc-docs").upload(path, file);
    if (up.error) return toast.error(up.error.message);
    const { error } = await supabase.from("kyc_documents").insert({
      lead_id: picked.id, doc_type, file_path: path, file_name: file.name, status: "pending",
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Uploaded"); loadDetail(picked.id);
  };

  const reviewDoc = async (id: string, status: "approved" | "rejected") => {
    const note = status === "rejected" ? (prompt("Reason?") ?? null) : null;
    await supabase.from("kyc_documents").update({ status, reviewer_note: note, reviewed_by: user!.id, reviewed_at: new Date().toISOString() }).eq("id", id);
    loadDetail(picked.id);
  };

  const activate = async () => {
    if (!picked) return;
    if (!confirm("Activate this lead? A customer and supply contract will be created.")) return;
    const { data: client, error: e1 } = await supabase.from("clients").insert({
      user_id: user!.id, company_name: picked.company_name, contact_name: picked.contact_name,
      contact_email: picked.contact_email, contact_phone: picked.contact_phone, country: picked.country,
    } as any).select().single();
    if (e1 || !client) return toast.error(e1?.message ?? "Failed");
    const accepted = quotes.find(q => q.status === "accepted") ?? quotes[0];
    if (accepted) {
      await supabase.from("supply_contracts").insert({
        user_id: user!.id, client_id: client.id, tariff_id: accepted.tariff_id,
        contract_number: `SC-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`,
        start_date: new Date().toISOString().slice(0, 10),
        annual_volume_mwh: accepted.annual_volume_mwh, status: "active",
      } as any);
    }
    await supabase.from("leads").update({ stage: "activated", converted_client_id: client.id }).eq("id", picked.id);
    // Send portal registration invite (email with sign-up link) now that a
    // contract exists — this is the "register" step of the Octopus-style flow.
    if (picked.contact_email) {
      const { error: invErr } = await supabase.functions.invoke("admin-invite-consumer", {
        body: { client_id: client.id, email: picked.contact_email, redirect_to: `${window.location.origin}/portal` },
      });
      if (invErr) toast.warning("Activated, but registration invite failed — send it manually from the client page.");
      else toast.success("Activated & registration invite sent");
    } else {
      toast.success("Activated (no email on file — send registration invite manually)");
    }
    setPicked(null); load();
  };

  const kpis = useMemo(() => {
    const pipelineValue = leads.filter(l => !["activated", "lost"].includes(l.stage)).reduce((s, l) => s + Number(l.est_value_eur || 0), 0);
    const closed = leads.filter(l => ["activated", "lost"].includes(l.stage)).length;
    const won = leads.filter(l => l.stage === "activated").length;
    const conv = closed ? (won / closed) * 100 : 0;
    const kycBacklog = leads.filter(l => l.stage === "kyc").length;
    return { pipelineValue, conv, kycBacklog, total: leads.length };
  }, [leads]);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Pipeline value" value={`€${fmtNum(kpis.pipelineValue)}`} />
        <Kpi label="Conversion rate" value={`${kpis.conv.toFixed(0)}%`} />
        <Kpi label="KYC backlog" value={String(kpis.kycBacklog)} />
        <Kpi label="Total leads" value={String(kpis.total)} />
      </div>

      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />New lead</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New lead</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); addLead(new FormData(e.currentTarget)); }} className="grid grid-cols-2 gap-3">
              <F name="company_name" label="Company" required className="col-span-2" />
              <F name="contact_name" label="Contact" />
              <F name="contact_email" label="Email" type="email" />
              <F name="contact_phone" label="Phone" />
              <F name="country" label="Country" />
              <div className="space-y-2"><Label>Source</Label>
                <Select name="source" defaultValue="web"><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["web", "referral", "cold", "switch_in"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              </div>
              <F name="owner" label="Owner" />
              <F name="est_annual_mwh" label="Est. annual MWh" type="number" step="0.01" />
              <F name="est_value_eur" label="Est. value €" type="number" step="0.01" />
              <DialogFooter className="col-span-2"><Button type="submit" style={{ background: "var(--gradient-primary)" }}>Create</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-3">
        {STAGES.map(s => {
          const items = leads.filter(l => l.stage === s.key);
          return (
            <Card key={s.key} className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs flex items-center justify-between">
                  <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${s.color}`} />{s.label}</span>
                  <span className="text-muted-foreground">{items.length}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 min-h-[80px]">
                {items.map(l => (
                  <button key={l.id} onClick={() => openLead(l)} className="w-full text-left p-2 rounded-md border border-border/60 hover:border-primary/40 bg-card/40 transition-colors">
                    <div className="text-sm font-medium truncate">{l.company_name}</div>
                    <div className="text-[10px] text-muted-foreground flex justify-between mt-1">
                      <span>{l.owner ?? "—"}</span><span>€{fmtNum(l.est_value_eur)}</span>
                    </div>
                  </button>
                ))}
                {items.length === 0 && <div className="text-[10px] text-muted-foreground text-center py-4">empty</div>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Sheet open={!!picked} onOpenChange={(o) => !o && setPicked(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-auto">
          {picked && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">{picked.company_name}
                  <Badge variant="secondary">{picked.stage}</Badge>
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex flex-wrap gap-1">
                {STAGES.map(s => (
                  <Button key={s.key} size="sm" variant={picked.stage === s.key ? "default" : "outline"} onClick={() => moveStage(picked.id, s.key)}>{s.label}</Button>
                ))}
              </div>
              <Tabs defaultValue="quote" className="mt-4">
                <TabsList><TabsTrigger value="quote">Quote</TabsTrigger><TabsTrigger value="kyc">KYC</TabsTrigger><TabsTrigger value="contract">Contract</TabsTrigger></TabsList>
                <TabsContent value="quote" className="space-y-4">
                  <form onSubmit={e => { e.preventDefault(); addQuote(new FormData(e.currentTarget)); (e.currentTarget as HTMLFormElement).reset(); }} className="grid grid-cols-2 gap-2 border border-border/60 rounded-md p-3">
                    <div className="space-y-2 col-span-2"><Label>Tariff</Label>
                      <Select name="tariff_id"><SelectTrigger><SelectValue placeholder="Select tariff" /></SelectTrigger>
                        <SelectContent>{tariffs.map(t => {
                          const ec = Array.isArray(t.components) ? t.components.find((c: any) => c.type === "energy") : null;
                          const price = Number(ec?.value ?? 0);
                          return <SelectItem key={t.id} value={t.id}>{t.code} — {price ? `${t.currency ?? "€"} ${price}/MWh` : t.name}</SelectItem>;
                        })}</SelectContent></Select>
                    </div>
                    <F name="term_months" label="Term (months)" type="number" defaultValue="12" />
                    <F name="margin_eur_mwh" label="Margin €/MWh" type="number" step="0.01" defaultValue="5" />
                    <F name="annual_volume_mwh" label="Annual MWh" type="number" step="0.01" defaultValue={picked.est_annual_mwh ?? 0} />
                    <div className="col-span-2"><Button type="submit" size="sm">Add quote</Button></div>
                  </form>
                  <div className="space-y-2">
                    {quotes.map(q => (
                      <div key={q.id} className="flex items-center justify-between text-sm border border-border/60 rounded-md p-2">
                        <div><div className="font-medium">€{fmtNum(q.annual_cost_eur)} / year</div>
                          <div className="text-xs text-muted-foreground">{fmtNum(q.annual_volume_mwh)} MWh × €{fmtNum(Number(q.base_price_eur_mwh) + Number(q.margin_eur_mwh))}/MWh · {q.term_months}m</div></div>
                        <Badge variant={q.status === "accepted" ? "default" : "secondary"}>{q.status}</Badge>
                      </div>
                    ))}
                    {quotes.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">No quotes yet</div>}
                  </div>
                </TabsContent>
                <TabsContent value="kyc" className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    {DOC_TYPES.map(dt => (
                      <label key={dt.v} className="border border-dashed border-border/60 rounded-md p-3 text-xs cursor-pointer hover:border-primary/40">
                        <div className="flex items-center gap-2 font-medium"><Upload className="h-3 w-3" />{dt.l}</div>
                        <input type="file" className="hidden" onChange={e => e.target.files?.[0] && uploadDoc(e.target.files[0], dt.v)} />
                      </label>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {docs.map(d => (
                      <div key={d.id} className="flex items-center justify-between text-xs border border-border/60 rounded-md p-2">
                        <div className="flex items-center gap-2"><FileText className="h-3 w-3" /><span className="font-medium">{DOC_TYPES.find(x => x.v === d.doc_type)?.l ?? d.doc_type}</span><span className="text-muted-foreground">{d.file_name}</span></div>
                        <div className="flex items-center gap-1">
                          {d.status === "pending" && <><Clock className="h-3 w-3 text-amber-500" /><Button size="sm" variant="ghost" onClick={() => reviewDoc(d.id, "approved")}><CheckCircle2 className="h-3 w-3 text-emerald-600" /></Button><Button size="sm" variant="ghost" onClick={() => reviewDoc(d.id, "rejected")}><XCircle className="h-3 w-3 text-rose-600" /></Button></>}
                          {d.status === "approved" && <Badge className="bg-emerald-600">approved</Badge>}
                          {d.status === "rejected" && <Badge variant="destructive">rejected</Badge>}
                        </div>
                      </div>
                    ))}
                    {docs.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">No documents</div>}
                  </div>
                </TabsContent>
                <TabsContent value="contract" className="space-y-3">
                  <div className="border border-border/60 rounded-md p-4 text-sm space-y-2">
                    <div className="font-medium">Activation checklist</div>
                    <div className="flex justify-between"><span>Accepted quote</span><Badge variant={quotes.some(q => q.status === "accepted") ? "default" : "secondary"}>{quotes.some(q => q.status === "accepted") ? "yes" : "missing"}</Badge></div>
                    <div className="flex justify-between"><span>KYC docs approved</span><Badge variant={docs.length > 0 && docs.every(d => d.status === "approved") ? "default" : "secondary"}>{docs.filter(d => d.status === "approved").length} / {docs.length}</Badge></div>
                  </div>
                  <Textarea placeholder="Internal notes" defaultValue={picked.notes ?? ""} onBlur={async (e) => { await supabase.from("leads").update({ notes: e.target.value }).eq("id", picked.id); }} />
                  <Button onClick={activate} className="w-full" style={{ background: "var(--gradient-primary)" }}><CheckCircle2 className="h-4 w-4 mr-2" />Activate customer</Button>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <Card className="border-border/60"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-2xl font-semibold mt-1">{value}</div></CardContent></Card>;
}
function F(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...rest } = props;
  return <div className={`space-y-2 ${className ?? ""}`}><Label htmlFor={rest.name}>{label}</Label><Input id={rest.name} {...rest} /></div>;
}