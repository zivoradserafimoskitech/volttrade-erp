import { ReactNode } from "react";
import { useAuth, AppRole } from "@/lib/auth";
import { ShieldAlert } from "lucide-react";

export function RoleGate({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  if (!hasRole(roles)) {
    return (
      <div className="rounded-lg border border-border/60 p-10 text-center text-sm text-muted-foreground bg-card/40">
        <ShieldAlert className="h-8 w-8 mx-auto mb-3 text-muted-foreground/60" />
        You don't have permission to view this page. Required role: {roles.join(' or ')}.
      </div>
    );
  }
  return <>{children}</>;
}