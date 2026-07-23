import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Zap } from "lucide-react";

export default function AuthPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  useEffect(() => { if (user) navigate("/", { replace: true }); }, [user, navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Welcome back"); navigate("/"); }
  };
  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Password reset email sent — check your inbox."); setForgotOpen(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center p-4" style={{ background: "var(--gradient-surface)" }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="h-11 w-11 rounded-xl grid place-items-center" style={{ background: "var(--gradient-primary)" }}>
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">VoltTrade ERP</div>
            <div className="text-xs text-muted-foreground">Electricity Trading & Supply</div>
          </div>
        </div>
        <Card className="border-border/70" style={{ boxShadow: "var(--shadow-card)" }}>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>VoltTrade ERP staff and Vatra customers sign in here.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={signIn}>
              <div className="space-y-2">
                <Label htmlFor="email-signin">Email</Label>
                <Input id="email-signin" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw-signin">Password</Label>
                <Input id="pw-signin" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="text-right -mt-2">
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2" onClick={() => { setForgotEmail(email); setForgotOpen(true); }}>
                  Forgot password?
                </button>
              </div>
              <Button type="submit" disabled={busy} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                {busy ? "Please wait…" : "Sign in"}
              </Button>
            </form>
            <div className="mt-6 pt-4 border-t border-border/60 space-y-2 text-xs text-center text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Vatra customer?</span>{" "}
                <Link to="/vatra/signup" className="underline underline-offset-2 text-primary">Create your account</Link>
              </div>
              <div>
                VoltTrade ERP access is by invitation only. Ask your administrator to send you an invite.
              </div>
            </div>
          </CardContent>
        </Card>
        <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset your password</DialogTitle>
              <DialogDescription>Enter your email and we'll send you a link to set a new password.</DialogDescription>
            </DialogHeader>
            <form onSubmit={sendReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input id="forgot-email" type="email" required value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <Button type="submit" disabled={busy} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}