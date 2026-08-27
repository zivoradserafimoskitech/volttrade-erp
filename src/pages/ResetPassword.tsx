import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Zap, AlertTriangle } from "lucide-react";

type Phase = "checking" | "ready" | "invalid";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState("");

  useEffect(() => {
    let done = false;
    // Guard both handlers: the SDK may auto-exchange ?code= on load while this
    // effect also exchanges it manually — the code is single-use, so the second
    // exchange fails and must not overwrite an already-successful result.
    const ok = () => { if (done) return; done = true; setPhase("ready"); };
    const fail = (msg: string) => { if (done) return; done = true; setLinkError(msg); setPhase("invalid"); };

    // Supabase reports failed/expired links via hash or query params.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const errCode = hash.get("error_code") ?? query.get("error_code");
    const errDesc = hash.get("error_description") ?? query.get("error_description");
    const err = hash.get("error") ?? query.get("error");

    if (err || errCode) {
      const expired = /expired/i.test(`${errCode} ${errDesc}`);
      fail(expired
        ? "This link has expired. Invitation and password-reset links are single-use and valid for a limited time."
        : (errDesc?.replace(/\+/g, " ") ?? "This link is no longer valid."));
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) ok();
    });

    (async () => {
      // PKCE-style links deliver a ?code= that must be exchanged for a session.
      const code = query.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          // The SDK may have already consumed the single-use code — treat an
          // existing session as success rather than declaring the link invalid.
          const { data } = await supabase.auth.getSession();
          if (data.session) return ok();
          return fail("This link has expired or was already used. Request a new one below.");
        }
        return ok();
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) return ok();
      // Give the SDK a moment to parse the URL fragment before declaring failure.
      setTimeout(() => { if (!done) fail("We couldn't validate this link. It may have expired or already been used."); }, 3000);
    })();

    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      if (/session|jwt|expired/i.test(error.message)) {
        setLinkError("Your recovery session expired before the password was saved. Request a new link below.");
        setPhase("invalid");
        return;
      }
      return toast.error(error.message);
    }
    toast.success("Password updated — you're signed in.");
    navigate("/dashboard", { replace: true });
  };

  const resend = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resendEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("New link sent — check your inbox (and spam folder).");
  };

  return (
    <div className="min-h-screen grid place-items-center p-4" style={{ background: "var(--gradient-surface)" }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="h-11 w-11 rounded-xl grid place-items-center" style={{ background: "var(--gradient-primary)" }}>
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">Set a new password</div>
            <div className="text-xs text-muted-foreground">Complete your password reset</div>
          </div>
        </div>
        <Card className="border-border/70" style={{ boxShadow: "var(--shadow-card)" }}>
          <CardHeader>
            <CardTitle>{phase === "invalid" ? "Link no longer valid" : "Choose a new password"}</CardTitle>
            <CardDescription>
              {phase === "ready" && "Enter and confirm your new password below."}
              {phase === "checking" && "Validating your recovery link…"}
              {phase === "invalid" && "Request a fresh link and open it in the same browser."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {phase === "invalid" ? (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Can't set your password</AlertTitle>
                  <AlertDescription>{linkError}</AlertDescription>
                </Alert>
                <form className="space-y-3" onSubmit={resend}>
                  <div className="space-y-2">
                    <Label htmlFor="resend">Your email</Label>
                    <Input id="resend" type="email" required value={resendEmail} onChange={e => setResendEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                    {busy ? "Sending…" : "Send me a new link"}
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  Tip: open the emailed link once, in the same browser — email apps that pre-scan links can consume it.
                </p>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="pw">New password</Label>
                  <Input id="pw" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw2">Confirm password</Label>
                  <Input id="pw2" type="password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
                </div>
                <Button type="submit" disabled={busy || phase !== "ready"} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                  {busy ? "Updating…" : phase === "ready" ? "Update password" : "Validating link…"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
