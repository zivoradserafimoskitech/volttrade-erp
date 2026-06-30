import { ReactNode } from "react";
import { Navigate, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Flame, LayoutDashboard, MapPin, Receipt, Gauge, User, LogOut, Handshake, Eye, ArrowLeft, Activity, Zap, Sparkles, Gift, Car, Bell } from "lucide-react";

const items = [
  { to: "/portal", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/portal/edus", label: "My supply points", icon: MapPin },
  { to: "/portal/hourly", label: "Hourly readings", icon: Activity },
  { to: "/portal/tariffs", label: "Tariffs", icon: Zap },
  { to: "/portal/savings", label: "Savings", icon: Sparkles },
  { to: "/portal/ev", label: "EV charging", icon: Car },
  { to: "/portal/refer", label: "Refer", icon: Gift },
  { to: "/portal/invoices", label: "Invoices", icon: Receipt },
  { to: "/portal/ppa", label: "My PPAs", icon: Handshake },
  { to: "/portal/readings", label: "Submit reading", icon: Gauge },
  { to: "/portal/notifications", label: "Notifications", icon: Bell },
  { to: "/portal/profile", label: "Profile", icon: User },
];

export function PortalLayout({ children, title }: { children: ReactNode; title: string }) {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
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
      <header className="h-16 border-b border-border px-4 md:px-8 flex items-center justify-between bg-card/40 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: "#241E17", border: "1px solid #3A3128" }}>
            <Flame className="h-5 w-5" style={{ color: "#FF6B2C" }} />
          </div>
          <div>
            <div className="font-semibold tracking-tight text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              vatra<span style={{ color: "#FF6B2C" }}>.</span>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Your energy</div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/auth"); }}><LogOut className="h-4 w-4 mr-2" />Sign out</Button>
      </header>
      <nav className="border-b border-border bg-card/20 px-4 md:px-8 overflow-x-auto">
        <div className="flex gap-1">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-3 text-sm border-b-2 whitespace-nowrap ${isActive ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-4 w-4" />{label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="flex-1 p-4 md:p-8 max-w-5xl w-full mx-auto space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}