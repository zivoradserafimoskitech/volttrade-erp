import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Building2, Save } from "lucide-react";

type Org = Record<string, any>;

const FIELDS: { key: string; label: string; placeholder?: string; span?: boolean }[] = [
  { key: "name", label: "Company name", placeholder: "VoltTrade" },
  { key: "short_name", label: "Short name", placeholder: "VT" },
  { key: "legal_name", label: "Legal name", placeholder: "VoltTrade DOOEL Skopje", span: true },
  { key: "registration_number", label: "Registration number (EMBS)" },
  { key: "tax_id", label: "Tax ID (EDB)" },
  { key: "vat_number", label: "VAT number" },
  { key: "eic_code", label: "EIC code", placeholder: "10X..." },
  { key: "licence_number", label: "Supply/trading licence no." },
  { key: "country_code", label: "Country code", placeholder: "MK" },
  { key: "address_line", label: "Address", span: true },
  { key: "city", label: "City" },
  { key: "postal_code", label: "Postal code" },
  { key: "contact_email", label: "Contact email" },
  { key: "contact_phone", label: "Contact phone" },
  { key: "website", label: "Website" },
  { key: "default_currency", label: "Default currency", placeholder: "EUR" },
  { key: "bank_name", label: "Bank name" },
  { key: "iban", label: "IBAN / account number" },
  { key: "swift", label: "SWIFT / BIC" },
  { key: "invoice_sender_email", label: "Invoice sender email", placeholder: "invoices@volttrade.app" },
];

export function CompanyProfileCard() {
  const [org, setOrg] = useState<Org | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from("organizations").select("*").limit(1).maybeSingle();
      if (error) return toast.error(error.message);
      setOrg(data ?? null);
    })();
  }, []);

  const set = (k: string, v: string) => setOrg(o => ({ ...(o ?? {}), [k]: v }));

  const save = async () => {
    if (!org?.id) return toast.error("No company record found for your account.");
    setSaving(true);
    const payload: Org = {};
    [...FIELDS.map(f => f.key), "invoice_footer_note"].forEach(k => {
      const v = org[k];
      payload[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null;
    });
    if (!payload.name) { setSaving(false); return toast.error("Company name is required."); }
    if (payload.country_code) payload.country_code = String(payload.country_code).toUpperCase();
    if (payload.default_currency) payload.default_currency = String(payload.default_currency).toUpperCase();
    else payload.default_currency = "EUR";
    const { error } = await (supabase as any).from("organizations").update(payload).eq("id", org.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Company details saved");
  };

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" />Company details (trader / supplier)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!org ? (
          <p className="text-sm text-muted-foreground">Loading company record…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map(f => (
                <div key={f.key} className={`space-y-2 ${f.span ? "sm:col-span-2" : ""}`}>
                  <Label htmlFor={`org-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`org-${f.key}`}
                    value={org[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={e => set(f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-footer">Invoice footer note</Label>
              <Textarea
                id="org-footer"
                rows={2}
                value={org.invoice_footer_note ?? ""}
                onChange={e => set("invoice_footer_note", e.target.value)}
                placeholder="Payment terms, registry entry, contact for billing questions…"
              />
            </div>
            <Button onClick={save} disabled={saving} style={{ background: "var(--gradient-primary)" }}>
              <Save className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save company details"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
