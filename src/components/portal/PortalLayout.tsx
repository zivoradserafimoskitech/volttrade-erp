import { ReactNode, useState } from "react";
import { Navigate, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, MapPin, Receipt, Gauge, User, LogOut, Handshake, Eye, ArrowLeft, Activity, Zap, Sparkles, Gift, Car, Bell, Grid3x3 } from "lucide-react";

// Primary tabs — bottom bar on mobile (A1-style), sidebar on desktop.
const primary = [
  { to: "/portal", label: "Дома", icon: LayoutDashboard, end: true as boolean | undefined },
  { to: "/portal/invoices", label: "Сметки", icon: Receipt },
  { to: "/portal/hourly", label: "Потрошувачка", icon: Activity },
  { to: "/portal/profile", label: "Профил", icon: User },
];
// Secondary — "Повеќе" sheet on mobile, listed in sidebar on desktop.
const secondary = [
  { to: "/portal/edus", label: "Мои мерни места", icon: MapPin },
  { to: "/portal/tariffs", label: "Тарифи", icon: Zap },
  { to: "/portal/savings", label: "Заштеди", icon: Sparkles },
  { to: "/portal/ev", label: "ЕВ полнење", icon: Car },
  { to: "/portal/refer", label: "Препорачај", icon: Gift },
  { to: "/portal/ppa", label: "Мои PPA", icon: Handshake },
  { to: "/portal/readings", label: "Внеси отчит", icon: Gauge },
  { to: "/portal/notifications", label: "Известувања", icon: Bell },
];
const items: { to: string; label: string; icon: any; end?: boolean }[] = [...primary, ...secondary];

export function PortalLayout({ children, title }: { children: ReactNode; title: string }) {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  const previewMode = (() => { try { return sessionStorage.getItem('viewAsCustomer') === '1'; } catch { return false; } })();
  return (
    <div
      className="vatra-portal min-h-screen flex flex-col bg-background"
      style={{
        // Ember palette scoped to the portal — overrides shadcn semantic tokens
        // so all child cards, charts and accents inherit the Vatra identity.
        ["--background" as any]: "24 18% 8%",
        ["--foreground" as any]: "30 25% 92%",
        ["--card" as any]: "24 18% 11%",
        ["--card-foreground" as any]: "30 25% 92%",
        ["--popover" as any]: "24 18% 11%",
        ["--popover-foreground" as any]: "30 25% 92%",
        ["--primary" as any]: "18 100% 58%",
        ["--primary-foreground" as any]: "24 30% 8%",
        ["--secondary" as any]: "24 14% 16%",
        ["--secondary-foreground" as any]: "30 25% 92%",
        ["--muted" as any]: "24 12% 14%",
        ["--muted-foreground" as any]: "30 12% 65%",
        ["--accent" as any]: "18 90% 52%",
        ["--accent-foreground" as any]: "24 30% 8%",
        ["--border" as any]: "24 14% 20%",
        ["--input" as any]: "24 14% 20%",
        ["--ring" as any]: "18 100% 58%",
      }}
    >
      {previewMode && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-700 dark:text-amber-300 px-4 md:px-8 py-2 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Eye className="h-3.5 w-3.5" /> Previewing the customer portal as staff — data shown is filtered to your own account.</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { try { sessionStorage.removeItem('viewAsCustomer'); } catch {} ; navigate('/'); }}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to staff ERP
          </Button>
        </div>
      )}
      {/* ── Header ── */}
      <header className="h-14 md:h-16 border-b border-border px-4 md:px-6 flex items-center justify-between bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div>
            <div className="font-semibold tracking-tight text-lg leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              vatra<span style={{ color: "#FF6B2C" }}>.</span>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Your energy</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <NavLink to="/portal/notifications" className="p-2 rounded-lg hover:bg-secondary" aria-label="Известувања">
            <Bell className="h-5 w-5" />
          </NavLink>
          <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/auth"); }} className="hidden md:inline-flex">
            <LogOut className="h-4 w-4 mr-2" />Одјава
          </Button>
        </div>
      </header>

      <div className="flex-1 flex w-full max-w-6xl mx-auto w-full">
        {/* ── Desktop sidebar ── */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border py-4 gap-0.5">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={(end as boolean) ?? false} className={({ isActive }) =>
              `flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl text-sm transition-colors ${isActive ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
              <Icon className="h-4 w-4 shrink-0" />{label}
            </NavLink>
          ))}
          <button onClick={async () => { await signOut(); navigate("/auth"); }}
            className="flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-secondary hover:text-foreground mt-auto">
            <LogOut className="h-4 w-4" />Одјава
          </button>
        </aside>

        {/* ── Content ── */}
        <main className="flex-1 min-w-0 p-4 md:p-6 pb-24 md:pb-6 space-y-4">
          {title && <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{title}</h1>}
          {children}
        </main>
      </div>

      {/* ── Mobile bottom navigation (A1-style) ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {primary.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={(end as boolean) ?? false} className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] ${isActive ? "text-primary" : "text-muted-foreground"}`}>
              <Icon className="h-5 w-5" />{label}
            </NavLink>
          ))}
          <button onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] ${moreOpen ? "text-primary" : "text-muted-foreground"}`}>
            <Grid3x3 className="h-5 w-5" />Повеќе
          </button>
        </div>
      </nav>

      {/* ── "More" sheet (mobile) ── */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/60 flex items-end" onClick={() => setMoreOpen(false)}>
          <div className="w-full bg-card rounded-t-2xl border-t border-border p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />
            <div className="grid grid-cols-3 gap-2">
              {secondary.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl bg-secondary/60 text-center">
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="text-[11px] leading-tight">{label}</span>
                </NavLink>
              ))}
            </div>
            <Button variant="ghost" className="w-full mt-3" onClick={async () => { await signOut(); navigate("/auth"); }}>
              <LogOut className="h-4 w-4 mr-2" />Одјава
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}