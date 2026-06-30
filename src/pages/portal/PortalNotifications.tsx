import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { enablePush, pushConfigured } from "@/lib/push";
import { toast } from "sonner";

type Prefs = {
  billing: boolean; savings: boolean; ev: boolean; alerts: boolean; outage: boolean; cheapest_slot: boolean;
};
const DEFAULTS: Prefs = { billing: true, savings: true, ev: true, alerts: true, outage: true, cheapest_slot: true };

const TOPICS: Array<{ key: keyof Prefs; label: string; desc: string }> = [
  { key: "billing", label: "Invoices & billing", desc: "New invoice issued, payment received, reminders" },
  { key: "savings", label: "Saving sessions", desc: "Upcoming session windows and your reward summary" },
  { key: "ev", label: "EV charging", desc: "Plan started, cheapest slots, charging completed" },
  { key: "cheapest_slot", label: "Cheapest tariff slots", desc: "Daily heads-up on the cheapest half-hour windows" },
  { key: "alerts", label: "Asset alerts", desc: "PV underperformance, BESS SoC, telemetry outages" },
  { key: "outage", label: "Outage notices", desc: "Planned and unplanned grid outages affecting your supply" },
];

export default function PortalNotifications() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [perm, setPerm] = useState<NotificationPermission>(typeof Notification !== "undefined" ? Notification.permission : "default");
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      if (data) setPrefs({ billing: data.billing, savings: data.savings, ev: data.ev, alerts: data.alerts, outage: data.outage, cheapest_slot: data.cheapest_slot });
    });
    supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30).then(({ data }) => {
      setHistory(data || []);
    });
  }, [user]);

  async function savePrefs(next: Prefs) {
    setPrefs(next);
    if (!user) return;
    await supabase.from("notification_preferences").upsert({ user_id: user.id, ...next });
  }

  async function handleEnable() {
    setBusy(true);
    const res = await enablePush();
    setBusy(false);
    setPerm(typeof Notification !== "undefined" ? Notification.permission : "default");
    if (res.ok) toast.success("Push notifications enabled on this device");
    else toast.error(res.reason || "Could not enable push");
  }

  const configured = pushConfigured();

  return (
    <PortalLayout title="Notifications">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-primary" /> Push on this device</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500" />
              <div>
                <div className="font-medium">Firebase keys not configured yet</div>
                <div className="text-muted-foreground text-xs">Your operator needs to add the Firebase web config and VAPID key. You can still pick which topics you want — they'll start sending once push is wired.</div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium">Browser permission</div>
              <div className="text-muted-foreground text-xs">{perm === "granted" ? "Allowed" : perm === "denied" ? "Blocked in browser settings" : "Not requested yet"}</div>
            </div>
            {perm === "granted" ? (
              <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Enabled</Badge>
            ) : (
              <Button onClick={handleEnable} disabled={busy || !configured}>
                <Bell className="h-4 w-4 mr-2" /> Enable push
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>What you want to hear about</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {TOPICS.map((t) => (
            <div key={t.key} className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
              <div>
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground">{t.desc}</div>
              </div>
              <Switch checked={prefs[t.key]} onCheckedChange={(v) => savePrefs({ ...prefs, [t.key]: v })} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent notifications</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2"><BellOff className="h-4 w-4" /> No notifications yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {history.map((n) => (
                <div key={n.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{n.title}</span>
                    <Badge variant="outline" className="text-[10px]">{n.topic}</Badge>
                  </div>
                  <div className="text-muted-foreground text-xs">{n.body}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PortalLayout>
  );
}