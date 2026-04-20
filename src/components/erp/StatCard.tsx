import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

export function StatCard({ label, value, icon: Icon, hint, accent }: { label: string; value: string; icon: LucideIcon; hint?: string; accent?: "primary" | "accent" | "warning" | "destructive" }) {
  const ring = {
    primary: "ring-primary/30 text-primary",
    accent: "ring-accent/30 text-accent",
    warning: "ring-warning/30 text-warning",
    destructive: "ring-destructive/30 text-destructive",
  }[accent ?? "primary"];
  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur">
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`h-11 w-11 rounded-lg grid place-items-center bg-secondary ring-1 ${ring}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold tracking-tight mt-1 truncate">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}