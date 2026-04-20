import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, LineChart, Receipt, Activity, LogOut, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/market", label: "Market Prices", icon: LineChart },
  { to: "/trading", label: "Trading", icon: Activity },
  { to: "/invoices", label: "Invoices", icon: Receipt },
];

export function Sidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <aside className="hidden md:flex w-64 flex-col border-r border-border bg-sidebar">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-sidebar-border">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
          <Zap className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="font-semibold tracking-tight text-sidebar-foreground">VoltTrade</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">ERP Suite</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary font-medium shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-sidebar-border space-y-2">
        <div className="text-xs text-muted-foreground px-2 truncate">{user?.email}</div>
        <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground" onClick={async () => { await signOut(); navigate("/auth"); }}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </div>
    </aside>
  );
}