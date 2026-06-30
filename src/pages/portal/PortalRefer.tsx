import { useEffect, useMemo, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Gift, Copy, Share2, Mail, Wallet } from "lucide-react";
import { fmtNum } from "@/lib/format";

const EMBER = "#FF6B2C";

const codeFor = (clientId: string) => `VATRA-${clientId.replace(/-/g,"").slice(0,8).toUpperCase()}`;

export default function PortalRefer() {
  const { user } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", email: "" });

  const load = async () => {
    if (!user) return;
    const { data: cl } = await supabase.from("clients").select("id").eq("portal_user_id", user.id).maybeSingle();
    if (!cl) return;
    setClientId(cl.id);
    const [{ data: r }, { data: l }] = await Promise.all([
      supabase.from("referrals").select("*").eq("referrer_client_id", cl.id).order("created_at", { ascending: false }),
      supabase.from("rewards_ledger").select("*").eq("client_id", cl.id).order("created_at", { ascending: false }).limit(50),
    ]);
    setReferrals(r ?? []);
    setLedger(l ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const code = clientId ? codeFor(clientId) : "";
  const link = code ? `${window.location.origin}/auth?ref=${code}` : "";

  const balance = useMemo(() => ledger.reduce((s, x) => s + Number(x.amount_eur || 0), 0), [ledger]);

  const send = async () => {
    if (!clientId || !form.email) return toast.error("Enter your friend's email");
    const { error } = await supabase.from("referrals").insert({
      referrer_client_id: clientId, code, referred_email: form.email, referred_name: form.name || null,
      status: "pending", credit_eur: 50,
    } as any);
    if (error) return toast.error(error.message);
    setForm({ name: "", email: "" });
    toast.success(`Invite saved — share your link with ${form.email}`);
    load();
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Link copied"); } catch { toast.error("Couldn't copy"); }
  };

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "Join Vatra", text: "Join me on Vatra and we both get €50 credit.", url: link }); } catch {}
    } else { copyLink(); }
  };

  return (
    <PortalLayout title="Refer a friend">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border p-6"
           style={{ background: "radial-gradient(120% 120% at 0% 0%, rgba(255,107,44,0.2) 0%, rgba(255,107,44,0) 55%), linear-gradient(135deg, #1A140F 0%, #100C09 100%)" }}>
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full blur-3xl opacity-40" style={{ background: EMBER }} />
        <div className="relative grid md:grid-cols-2 gap-6 items-center">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest" style={{ color: "#FFB082" }}><Gift className="h-3.5 w-3.5" /> Give €50, get €50</div>
            <div className="text-2xl md:text-3xl font-semibold mt-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Share Vatra with friends
            </div>
            <div className="text-sm text-muted-foreground mt-2">
              When a friend signs up using your link and stays for 30 days, you both get €50 credit on your next bill.
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Your referral link</Label>
              <div className="flex gap-2 mt-1">
                <Input readOnly value={link} className="font-mono text-xs" />
                <Button variant="outline" onClick={copyLink}><Copy className="h-4 w-4" /></Button>
                <Button onClick={share} style={{ background: EMBER, color: "#1A140F" }}><Share2 className="h-4 w-4 mr-2" />Share</Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">Code: <span className="font-mono text-foreground">{code}</span></div>
          </div>
        </div>
      </div>

      {/* Balance + send by email */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Rewards balance</div>
            <div className="h-7 w-7 rounded-md grid place-items-center" style={{ background: "rgba(255,107,44,0.12)", color: EMBER }}><Wallet className="h-3.5 w-3.5" /></div>
          </div>
          <div className="text-3xl font-semibold mt-2" style={{ fontFamily: "'Space Grotesk', sans-serif", color: EMBER }}>€{fmtNum(balance)}</div>
          <div className="text-xs text-muted-foreground mt-1">Auto-applied to your next invoice</div>
        </CardContent></Card>
        <Card className="md:col-span-2"><CardContent className="p-4 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2"><Mail className="h-4 w-4" style={{ color: EMBER }} /> Invite by email</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="Friend's name (optional)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Input placeholder="friend@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="sm:col-span-1" />
            <Button onClick={send} style={{ background: EMBER, color: "#1A140F" }}>Track invite</Button>
          </div>
          <div className="text-xs text-muted-foreground">We won't email them automatically — share your link however you'd like, this just keeps track of who you've invited.</div>
        </CardContent></Card>
      </div>

      {/* Referrals list */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Your referrals</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Friend</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Credit</TableHead><TableHead>Sent</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {referrals.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">No referrals yet. Share your link to get started.</TableCell></TableRow>
              ) : referrals.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{r.referred_name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.referred_email}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">€{fmtNum(r.credit_eur)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Ledger */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Rewards ledger</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Note</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Points</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {ledger.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">No rewards earned yet.</TableCell></TableRow>
              ) : ledger.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{new Date(l.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline">{l.entry_type}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.note ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums" style={{ color: l.amount_eur >= 0 ? EMBER : undefined }}>€{fmtNum(l.amount_eur)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.points ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PortalLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "credited" ? "#22c55e" : status === "signed_up" ? "#3b82f6" : status === "expired" ? "#9ca3af" : EMBER;
  return <Badge variant="outline" style={{ color, borderColor: `${color}55` }}>{status}</Badge>;
}