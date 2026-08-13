import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MailX, CheckCircle2, AlertTriangle } from "lucide-react";

type State = "loading" | "valid" | "already" | "invalid" | "done" | "error";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
    fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok || body?.valid === false) { setState(body?.already_unsubscribed ? "already" : "invalid"); return; }
        setEmail(body?.email ?? null);
        setState(body?.already_unsubscribed ? "already" : "valid");
      })
      .catch(() => setState("error"));
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    const { error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    setBusy(false);
    setState(error ? "error" : "done");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MailX className="h-4 w-4" /> Email preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          {state === "loading" && <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Checking your link…</p>}
          {state === "valid" && (
            <>
              <p>Unsubscribe {email ? <strong className="text-foreground">{email}</strong> : "this address"} from VoltTrade notification emails? Legally required billing documents may still be delivered in the portal.</p>
              <Button onClick={confirm} disabled={busy} className="w-full">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Confirm unsubscribe
              </Button>
            </>
          )}
          {state === "already" && <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> This address is already unsubscribed.</p>}
          {state === "done" && <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> You have been unsubscribed.</p>}
          {state === "invalid" && <p className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> This unsubscribe link is invalid or expired.</p>}
          {state === "error" && <p className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Something went wrong. Please try again later.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
