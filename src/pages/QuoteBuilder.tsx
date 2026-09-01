// src/pages/QuoteBuilder.tsx
// Profile-based supply quote builder with capture-factor pricing.
// Integrates with lead_quotes table.

import { useEffect, useState } from "react";
import { useSupabaseClient, useUser } from "@supabase/auth-helpers-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Calculator, TrendingDown, TrendingUp, Zap, DollarSign, Save, Copy } from "lucide-react";
import { quoteSupply, getCaptureFactors, getOrgRiskSettings } from "@/lib/volttrade";

interface CaptureFactor {
  profile_key: string;
  capture_factor: number;
  note: string;
}

interface QuoteResult {
  profile_key: string;
  capture_factor: number;
  baseload_price: number;
  captured_price: number;
  margin_eur_mwh: number;
  volume_risk_premium: number;
  required_price: number;
  offer_price: number;
  annual_mwh: number;
  estimated_annual_margin: number;
  capacity_check: {
    current_sold_mwh: number;
    proposed_total_mwh: number;
    max_capacity_mwh: number;
    ok: boolean;
  };
  competitive: {
    competitor_price: number;
    savings_vs_competitor: number;
    savings_pct: number;
  };
  note: string;
}

export default function QuoteBuilder() {
  const supabase = useSupabaseClient();
  const user = useUser();
  const [profiles, setProfiles] = useState<CaptureFactor[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [profileKey, setProfileKey] = useState("1shift_08_16");
  const [annualMwh, setAnnualMwh] = useState("440");
  const [baseloadPrice, setBaseloadPrice] = useState("");
  const [margin, setMargin] = useState("");
  const [volumeSigma, setVolumeSigma] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split("T")[0]);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const factors = await getCaptureFactors();
      setProfiles(factors || []);

      if (user) {
        const { data: mem } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", user.id)
          .single();
        if (mem) setOrgId(mem.organization_id);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function calculateQuote() {
    if (!orgId) {
      setError("Organization not found");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await quoteSupply({
        profile_key: profileKey,
        annual_mwh: parseFloat(annualMwh) || 0,
        baseload_price: baseloadPrice ? parseFloat(baseloadPrice) : undefined,
        margin_eur_mwh: margin ? parseFloat(margin) : undefined,
        volume_sigma: volumeSigma ? parseFloat(volumeSigma) : undefined,
      });

      if (result.error) throw new Error(result.error);
      setQuote(result);
    } catch (e: any) {
      setError(e.message);
    }

    setLoading(false);
  }

  async function saveQuote() {
    if (!quote || !orgId) return;

    setSaving(true);
    try {
      const { data, error } = await supabase.from("lead_quotes").insert({
        organization_id: orgId,
        customer_name: customerName || "Unnamed",
        profile_key: quote.profile_key,
        base_price_eur_mwh: quote.baseload_price,
        margin_eur_mwh: quote.margin_eur_mwh,
        total_price_eur_mwh: quote.offer_price,
        capture_factor: quote.capture_factor,
        captured_price_eur_mwh: quote.captured_price,
        volume_risk_premium_eur_mwh: quote.volume_risk_premium,
        required_price_eur_mwh: quote.required_price,
        annual_volume_mwh: parseFloat(annualMwh),
        start_date: startDate,
        end_date: endDate,
        risk_capacity_ok: quote.capacity_check.ok,
        status: "draft",
      }).select();

      if (error) throw error;
      alert(`Quote saved! ID: ${data[0].id}`);
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  const selectedProfile = profiles.find(p => p.profile_key === profileKey);

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Quote Builder</h1>
        <p className="text-muted-foreground mt-1">
          Profile-based pricing using measured capture factors. 
          The difference between best (0.801) and worst (1.124) profile is 32 EUR/MWh.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" /> Quote Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Customer Name</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Metalworks Ltd" />
            </div>

            <div className="space-y-2">
              <Label>Consumption Profile *</Label>
              <Select value={profileKey} onValueChange={setProfileKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.profile_key} value={p.profile_key}>
                      {p.profile_key} — {p.note}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProfile && (
                <p className="text-xs text-muted-foreground">
                  Capture factor: {selectedProfile.capture_factor} — {selectedProfile.note}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Annual MWh *</Label>
                <Input type="number" value={annualMwh} onChange={(e) => setAnnualMwh(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Baseload Price (EUR/MWh)</Label>
                <Input type="number" value={baseloadPrice} onChange={(e) => setBaseloadPrice(e.target.value)} placeholder="Auto" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Margin (EUR/MWh)</Label>
                <Input type="number" value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="Auto from settings" />
              </div>
              <div className="space-y-2">
                <Label>Volume Sigma</Label>
                <Input type="number" value={volumeSigma} onChange={(e) => setVolumeSigma(e.target.value)} placeholder="Auto" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <Button onClick={calculateQuote} disabled={loading} className="w-full">
              {loading ? "Calculating..." : "Calculate Quote"}
            </Button>
          </CardContent>
        </Card>

        {/* Result */}
        <Card className={quote ? "border-green-500" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" /> Quote Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!quote ? (
              <div className="text-center text-muted-foreground py-12">
                <Calculator className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Fill in the parameters and click Calculate</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Big number */}
                <div className="text-center p-6 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">Offer Price</div>
                  <div className="text-5xl font-bold text-green-600">{quote.offer_price.toFixed(2)}</div>
                  <div className="text-sm text-muted-foreground">EUR/MWh</div>
                </div>

                {/* Breakdown */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Baseload price</span>
                    <span>{quote.baseload_price.toFixed(2)} EUR/MWh</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Capture factor</span>
                    <Badge variant="outline">{quote.capture_factor}</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Captured price</span>
                    <span>{quote.captured_price.toFixed(2)} EUR/MWh</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Margin</span>
                    <span>+{quote.margin_eur_mwh.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Volume risk premium</span>
                    <span>+{quote.volume_risk_premium.toFixed(2)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-medium">
                    <span>Required price</span>
                    <span>{quote.required_price.toFixed(2)}</span>
                  </div>
                </div>

                {/* Competitive */}
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="text-sm font-medium text-blue-800">Competitive Advantage</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {quote.competitive.savings_vs_competitor.toFixed(2)} EUR/MWh
                  </div>
                  <div className="text-sm text-blue-700">
                    {quote.competitive.savings_pct}% cheaper than typical competitor
                  </div>
                </div>

                {/* Capacity */}
                <div className={`p-4 rounded-lg ${quote.capacity_check.ok ? "bg-green-50" : "bg-red-50"}`}>
                  <div className="text-sm font-medium">
                    Capacity: {quote.capacity_check.current_sold_mwh} → {quote.capacity_check.proposed_total_mwh} / {quote.capacity_check.max_capacity_mwh} MWh
                  </div>
                  <div className="text-sm">
                    {quote.capacity_check.ok ? "✓ Within capacity" : "⚠ Exceeds capacity limit"}
                  </div>
                </div>

                {/* Annual margin */}
                <div className="flex justify-between items-center p-4 bg-muted rounded-lg">
                  <div>
                    <div className="text-sm text-muted-foreground">Estimated Annual Margin</div>
                    <div className="text-2xl font-bold">{quote.estimated_annual_margin.toLocaleString()} EUR</div>
                  </div>
                  <Button onClick={saveQuote} disabled={saving || !quote.capacity_check.ok}>
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? "Saving..." : "Save Quote"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
