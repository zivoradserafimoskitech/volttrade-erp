import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Zap } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase recovery link establishes a temporary session on landing.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated — you're signed in.");
    navigate("/", { replace: true });
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
            <CardTitle>Choose a new password</CardTitle>
            <CardDescription>
              {ready ? "Enter and confirm your new password below." : "Validating your recovery link…"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="pw">New password</Label>
                <Input id="pw" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
              </div>
              <Button type="submit" disabled={busy || !ready} className="w-full" style={{ background: "var(--gradient-primary)" }}>
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}