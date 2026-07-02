import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { lovable } from "@/integrations/lovable";

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
  const signUp = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Account created — you can sign in now.");
  };
  const signInGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) { toast.error(result.error.message ?? "Google sign-in failed"); setBusy(false); return; }
    if (result.redirected) return;
    navigate("/");
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
            <CardTitle>Sign in to your workspace</CardTitle>
            <CardDescription>Manage clients, market prices, nominations and invoices.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" className="w-full mb-4" disabled={busy} onClick={signInGoogle}>
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </Button>
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or with email</span></div>
            </div>
            <Tabs defaultValue="signin">
              <TabsList className="grid grid-cols-2 w-full mb-4">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>
              {(["signin","signup"] as const).map(t => (
                <TabsContent key={t} value={t}>
                  <form className="space-y-4" onSubmit={t === "signin" ? signIn : signUp}>
                    <div className="space-y-2">
                      <Label htmlFor={`email-${t}`}>Email</Label>
                      <Input id={`email-${t}`} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="trader@volttrade.eu" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`pw-${t}`}>Password</Label>
                      <Input id={`pw-${t}`} type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                    </div>
                    {t === "signin" && (
                      <div className="text-right -mt-2">
                        <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2" onClick={() => { setForgotEmail(email); setForgotOpen(true); }}>
                          Forgot password?
                        </button>
                      </div>
                    )}
                    <Button type="submit" disabled={busy} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                      {busy ? "Please wait…" : t === "signin" ? "Sign in" : "Create account"}
                    </Button>
                  </form>
                </TabsContent>
              ))}
            </Tabs>
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