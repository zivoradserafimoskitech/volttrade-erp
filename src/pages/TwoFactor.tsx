import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldCheck, LogOut } from "lucide-react";

type Mode = "loading" | "enroll" | "verify_enroll" | "challenge" | "done";

export default function TwoFactor() {
  const { user, loading, refreshAal, signOut } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/auth", { replace: true }); return; }
    (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") { navigate("/", { replace: true }); return; }
      const { data: list } = await supabase.auth.mfa.listFactors();
      const verified = list?.totp?.find((f: any) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMode("challenge");
      } else {
        await beginEnroll();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  const beginEnroll = async () => {
    // Clean up any prior unverified factor to avoid the "friendly_name already exists" error.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.totp ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `VoltTrade ${Date.now()}` });
    if (error) { toast.error(error.message); return; }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setMode("verify_enroll");
  };

  const verifyEnroll = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error) { setBusy(false); return toast.error(ch.error.message); }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Two-factor authentication enabled");
    await refreshAal();
    navigate("/", { replace: true });
  };

  const challenge = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error) { setBusy(false); return toast.error(ch.error.message); }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
    setBusy(false);
    if (error) return toast.error(error.message);
    await refreshAal();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen grid place-items-center p-4" style={{ background: "var(--gradient-surface)" }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="h-11 w-11 rounded-xl grid place-items-center" style={{ background: "var(--gradient-primary)" }}>
            <ShieldCheck className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">Two-factor authentication</div>
            <div className="text-xs text-muted-foreground">Required for VoltTrade staff</div>
          </div>
        </div>
        <Card className="border-border/70" style={{ boxShadow: "var(--shadow-card)" }}>
          {mode === "loading" && (
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Checking your account…</CardContent>
          )}
          {mode === "verify_enroll" && (
            <>
              <CardHeader>
                <CardTitle>Set up your authenticator</CardTitle>
                <CardDescription>Scan the QR with Google Authenticator, Authy, or 1Password, then enter the 6-digit code.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid place-items-center p-4 rounded-lg bg-background border border-border">
                  {qr && <img src={qr} alt="TOTP QR code" className="h-48 w-48" />}
                </div>
                <div className="text-xs text-muted-foreground break-all">
                  Can't scan? Enter this secret manually: <code className="font-mono text-foreground">{secret}</code>
                </div>
                <form className="space-y-3" onSubmit={verifyEnroll}>
                  <div className="space-y-2">
                    <Label htmlFor="code">6-digit code</Label>
                    <Input id="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
                  </div>
                  <Button type="submit" disabled={busy || code.length !== 6} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                    {busy ? "Verifying…" : "Verify & activate"}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
          {mode === "challenge" && (
            <>
              <CardHeader>
                <CardTitle>Enter your 6-digit code</CardTitle>
                <CardDescription>Open your authenticator app and enter the current code for VoltTrade.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={challenge}>
                  <div className="space-y-2">
                    <Label htmlFor="code">Code</Label>
                    <Input id="code" autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
                  </div>
                  <Button type="submit" disabled={busy || code.length !== 6} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                    {busy ? "Verifying…" : "Continue"}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
        <div className="mt-4 text-center">
          <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/auth", { replace: true }); }}>
            <LogOut className="h-3.5 w-3.5 mr-2" /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}