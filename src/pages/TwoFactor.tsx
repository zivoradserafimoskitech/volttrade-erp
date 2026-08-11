import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldCheck, LogOut, RotateCcw } from "lucide-react";
import QRCode from "qrcode";

type Mode = "loading" | "enroll" | "verify_enroll" | "challenge" | "manage" | "done";

export default function TwoFactor() {
  const { user, loading, refreshAal, signOut } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [factors, setFactors] = useState<any[]>([]);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPw, setResetPw] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetting, setResetting] = useState(false);

  // Self-service recovery for a lost/uninstalled authenticator. Must live here:
  // /2fa is the only screen a staff member at AAL1 can reach.
  const resetMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetting(true);
    await supabase.auth.refreshSession().catch(() => null);
    const { data, error } = await supabase.functions.invoke("reset-own-mfa", {
      body: { password: resetPw, email: resetEmail || user?.email || undefined },
    });
    setResetting(false);
    if (error || (data as any)?.error) {
      let msg = (data as any)?.error ?? error?.message ?? "Reset failed";
      const ctx = (error as any)?.context;
      if (ctx && typeof ctx.json === "function") {
        try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      }
      toast.error(msg);
      return;
    }
    toast.success("Old authenticator removed — scan the new QR code below.");
    setResetOpen(false);
    setResetPw("");
    setResetEmail("");
    setCode("");
    await refreshAal();
    await beginEnroll();
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/auth", { replace: true }); return; }
    (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: list } = await supabase.auth.mfa.listFactors();
      const verified = list?.totp?.find((f: any) => f.status === "verified");
      if (aal?.currentLevel === "aal2") {
        // Already fully authenticated — show a manage screen instead of bouncing away.
        setFactors(list?.totp ?? []);
        setMode("manage");
        return;
      }
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
    setSecret(data.totp.secret);

    // Re-render the QR code with a clean issuer name so Authenticator apps show "VoltTrade"
    // instead of the preview/published domain.
    const issuer = "VoltTrade";
    const account = user?.email ?? user?.phone ?? "staff";
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${data.totp.secret}&issuer=${encodeURIComponent(issuer)}`;
    try {
      const dataUrl = await QRCode.toDataURL(otpauth, { width: 384, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
      setQr(dataUrl);
    } catch {
      setQr(data.totp.qr_code);
    }
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
    navigate("/dashboard", { replace: true });
  };

  const removeFactor = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Authenticator removed");
    await refreshAal();
    setCode("");
    await beginEnroll();
  };

  // Turn 2FA off entirely: unenroll every factor and go back to the app.
  const disableMfa = async () => {
    setBusy(true);
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.totp ?? []) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) { setBusy(false); return toast.error(error.message); }
    }
    setBusy(false);
    toast.success("Two-factor authentication turned off");
    await refreshAal();
    navigate("/dashboard", { replace: true });
  };

  const challenge = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error) { setBusy(false); return toast.error(ch.error.message); }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
    setBusy(false);
    if (error) return toast.error(error.message);
    await refreshAal();
    navigate("/dashboard", { replace: true });
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
          {mode === "manage" && (
            <>
              <CardHeader>
                <CardTitle>Two-factor is active</CardTitle>
                <CardDescription>Your staff account is protected with a TOTP authenticator app.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  {factors.filter(f => f.status === "verified").map(f => (
                    <div key={f.id} className="flex items-center justify-between rounded-lg border border-border/70 p-3">
                      <div>
                        <div className="text-sm font-medium">{f.friendly_name ?? "Authenticator"}</div>
                        <div className="text-xs text-muted-foreground">Added {new Date(f.created_at).toLocaleDateString()}</div>
                      </div>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => removeFactor(f.id)}>
                        Replace
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  "Replace" removes the current authenticator and immediately shows a new QR code to scan.
                </p>
                <Button variant="destructive" className="w-full" disabled={busy} onClick={disableMfa}>
                  <ShieldOff className="h-4 w-4 mr-2" /> Turn off two-factor authentication
                </Button>
                <Button variant="outline" className="w-full" onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
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
                <div className="mt-4 border-t border-border/60 pt-4 text-center">
                  <p className="text-xs text-muted-foreground mb-2">Lost or deleted your authenticator app?</p>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setResetOpen(true)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-2" /> Reset 2FA with my password
                  </Button>
                </div>
              </CardContent>
            </>
          )}
        </Card>

        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset your two-factor authentication</DialogTitle>
              <DialogDescription>
                Enter your account password to remove the unusable authenticator. You'll then scan a new QR code to finish signing in.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={resetMfa} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Account email</Label>
                <Input id="reset-email" type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder={user?.email ?? "you@company.com"} />
                <p className="text-xs text-muted-foreground">Only needed if your session has expired.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-pw">Current password</Label>
                <Input id="reset-pw" type="password" required value={resetPw} onChange={e => setResetPw(e.target.value)} placeholder="••••••••" />
              </div>
              <Button type="submit" disabled={resetting || !resetPw} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                {resetting ? "Resetting…" : "Reset 2FA"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <div className="mt-4 text-center">
          <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/auth", { replace: true }); }}>
            <LogOut className="h-3.5 w-3.5 mr-2" /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}