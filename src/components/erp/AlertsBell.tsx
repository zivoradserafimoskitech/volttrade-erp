import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

/**
 * Unread-alert badge in the ERP header. RLS scopes rows to the caller's
 * organisation, so no organization_id filter belongs here.
 */
export function AlertsBell() {
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { count } = await (supabase.from as any)("alerts")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (!cancelled) setUnread(count ?? 0);
    };
    check();
    const id = setInterval(check, 60_000);
    const onChanged = () => check();
    window.addEventListener("volttrade:alerts-changed", onChanged);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener("volttrade:alerts-changed", onChanged); };
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={t("Alerts")}
      onClick={() => navigate("/alerts")}
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Button>
  );
}
