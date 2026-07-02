import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Flame } from "lucide-react";

type Step = "signup" | "link";

export default function VatraSignup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pod, setPod] = useState("");
  const [busy, setBusy] = useState(false);

  const doSignup = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    // Attempt sign-up; if the email exists, try sign-in so they can still link a POD.
    const up = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/portal` } });
    if (up.error) {
      const si = await supabase.auth.signInWithPassword({ email, password });
      if (si.error) { setBusy(false); return toast.error(up.error.message); }
    }
    setBusy(false);
    setStep("link");
  };

  const doLink = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { data, error } = await supabase.functions.invoke("link-consumer-pod", {
      body: { pod_code: pod.trim() },
    });
    setBusy(false);
    if (error || (data as any)?.error) return toast.error((data as any)?.error ?? error?.message ?? "Could not link account");
    toast.success("Account linked to your supply point");
    navigate("/portal", { replace: true });
  };

  const skipLink = () => navigate("/portal", { replace: true });

  return (
    <div className="vatra-portal min-h-screen grid place-items-center p-4"
      style={{
        background: "#181410",
        ["--background" as any]: "24 18% 8%",
        ["--foreground" as any]: "30 25% 92%",
        ["--card" as any]: "24 18% 11%",
        ["--card-foreground" as any]: "30 25% 92%",
        ["--primary" as any]: "18 100% 58%",
        ["--primary-foreground" as any]: "24 30% 8%",
        ["--border" as any]: "24 14% 20%",
        ["--muted-foreground" as any]: "30 12% 65%",
        ["--input" as any]: "24 14% 20%",
        ["--ring" as any]: "18 100% 58%",
      }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="h-11 w-11 rounded-xl grid place-items-center" style={{ background: "#241E17", border: "1px solid #3A3128" }}>
            <Flame className="h-6 w-6" style={{ color: "#FF6B2C" }} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              vatra<span style={{ color: "#FF6B2C" }}>.</span>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Your energy</div>
          </div>
        </div>
        <Card className="border-border/70">
          {step === "signup" && (
            <>
              <CardHeader>
                <CardTitle>Create your Vatra account</CardTitle>
                <CardDescription>Track your usage, tariffs, invoices and savings — all in one place.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={doSignup}>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                    <p className="text-[11px] text-muted-foreground">Use the email your supplier has on file, so we can link your supply point.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pw">Password</Label>
                    <Input id="pw" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                    {busy ? "Please wait…" : "Continue"}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Already have an account? <Link to="/auth" className="underline">Sign in</Link>
                  </p>
                </form>
              </CardContent>
            </>
          )}
          {step === "link" && (
            <>
              <CardHeader>
                <CardTitle>Link your supply point</CardTitle>
                <CardDescription>Enter your POD / EIC code (found on your invoice). We'll match it to the email on your account.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={doLink}>
                  <div className="space-y-2">
                    <Label htmlFor="pod">POD / EIC code</Label>
                    <Input id="pod" required value={pod} onChange={e => setPod(e.target.value)} placeholder="e.g. MK00X1234567890" />
                  </div>
                  <Button type="submit" disabled={busy || !pod.trim()} className="w-full" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                    {busy ? "Linking…" : "Link my account"}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={skipLink}>Skip for now</Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}