import { ReactNode } from "react";
import { Navigate, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Zap, LayoutDashboard, MapPin, Receipt, Gauge, User, LogOut, Handshake } from "lucide-react";

const items = [
  { to: "/portal", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/portal/edus", label: "My supply points", icon: MapPin },
  { to: "/portal/invoices", label: "Invoices", icon: Receipt },
  { to: "/portal/ppa", label: "My PPAs", icon: Handshake },
  { to: "/portal/readings", label: "Submit reading", icon: Gauge },
  { to: "/portal/profile", label: "Profile", icon: User },
];

export function PortalLayout({ children, title }: { children: ReactNode; title: string }) {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-16 border-b border-border px-4 md:px-8 flex items-center justify-between bg-card/40 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}><Zap className="h-5 w-5 text-primary-foreground" /></div>
          <div><div className="font-semibold tracking-tight">VoltTrade Portal</div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Customer area</div></div>
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