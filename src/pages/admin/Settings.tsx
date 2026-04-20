import { useEffect, useState } from "react";
import { ErpLayout } from "@/components/erp/Layout";
import { RoleGate } from "@/components/erp/RoleGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ code: "", name: "", currency: "EUR", vat_percent: 0, tso_code: "" });
  const load = async () => { const { data } = await supabase.from("countries").select("*").order("code"); setRows(data ?? []); };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const { error } = await supabase.from("countries").insert(form);
    if (error) return toast.error(error.message);
    toast.success("Country added"); setForm({ code: "", name: "", currency: "EUR", vat_percent: 0, tso_code: "" }); load();
  };
  const del = async (code: string) => { const { error } = await supabase.from("countries").delete().eq("code", code); if (error) return toast.error(error.message); load(); };

  return (
    <ErpLayout title="Settings" subtitle="System configuration: countries, VAT, TSO codes">
      <RoleGate roles={['admin']}>
        <Card className="border-border/60">
          <CardHeader><CardTitle>Add country</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-5 gap-3 items-end">
            <div className="space-y-2"><Label>Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="HU" /></div>
            <div className="space-y-2 col-span-2"><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Currency</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-2"><Label>VAT %</Label><Input type="number" step="0.1" value={form.vat_percent} onChange={e => setForm({ ...form, vat_percent: Number(e.target.value) })} /></div>
            <div className="space-y-2 col-span-2"><Label>TSO code</Label><Input value={form.tso_code} onChange={e => setForm({ ...form, tso_code: e.target.value })} /></div>
            <Button onClick={add} className="col-span-3" style={{ background: "var(--gradient-primary)" }}><Plus className="h-4 w-4 mr-2" />Add country</Button>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader><CardTitle>Countries ({rows.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Currency</TableHead><TableHead>VAT %</TableHead><TableHead>TSO</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.code}>
                    <TableCell className="font-mono">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell>{r.vat_percent}</TableCell>
                    <TableCell>{r.tso_code ?? '—'}</TableCell>
                    <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => del(r.code)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </RoleGate>
    </ErpLayout>
  );
}