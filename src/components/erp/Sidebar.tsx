import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, LineChart, Receipt, Activity, LogOut, Zap, MapPin, Tags, FileText, Gauge, Calculator, Wallet, ShieldCheck, Settings as SettingsIcon, Building2, FileSignature, CalendarClock, AlertTriangle, TrendingUp, History } from "lucide-react";
import { useAuth, AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Item = { to: string; label: string; icon: any; end?: boolean; roles?: AppRole[] };
const groups: { title: string; items: Item[] }[] = [
  { title: "Management", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  ]},
  { title: "Supply", items: [
    { to: "/clients", label: "Customers", icon: Users },
    { to: "/supply-points", label: "Supply Points", icon: MapPin },
    { to: "/tariffs", label: "Tariffs", icon: Tags },
    { to: "/contracts", label: "Supply Contracts", icon: FileText },
    { to: "/readings", label: "Meter Readings", icon: Gauge },
    { to: "/billing", label: "Billing Runs", icon: Calculator },
    { to: "/invoices", label: "Invoices", icon: Receipt },
    { to: "/payments", label: "Payments", icon: Wallet },
  ]},
  { title: "Trading", items: [
    { to: "/market", label: "Market Prices", icon: LineChart },
    { to: "/counterparties", label: "Counterparties", icon: Building2 },
    { to: "/trading-contracts", label: "Trading Contracts", icon: FileSignature },
    { to: "/trading", label: "Trade Blotter", icon: Activity },
    { to: "/schedules", label: "Schedules", icon: CalendarClock },
  ]},
  { title: "Risk", items: [
    { to: "/risk", label: "Risk & Exposure", icon: AlertTriangle, roles: ['risk_officer','management','admin'] },
  ]},
  { title: "Planning", items: [
    { to: "/forecasting", label: "Forecasting", icon: TrendingUp, roles: ['management','trader','supply_manager','admin'] },
  ]},
  { title: "Admin", items: [
    { to: "/admin/users", label: "Users & Roles", icon: ShieldCheck, roles: ['admin'] },
    { to: "/admin/audit", label: "Audit Log", icon: History, roles: ['admin','auditor'] },
    { to: "/admin/settings", label: "Settings", icon: SettingsIcon, roles: ['admin'] },
  ]},
];

export function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const { user, signOut, hasRole, roles } = useAuth();
  const navigate = useNavigate();
  return (
    <aside className={`${mobile ? "flex" : "hidden md:flex"} w-full md:w-64 flex-col border-r border-border bg-sidebar overflow-y-auto h-full`}>
      <div className="h-16 flex items-center gap-2 px-5 border-b border-sidebar-border">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
          <Zap className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="font-semibold tracking-tight text-sidebar-foreground">VoltTrade</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">ETRM / ERP</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-4">
        {groups.map(g => {
          const visible = g.items.filter(i => !i.roles || hasRole(i.roles));
          if (visible.length === 0) return null;
          return (
            <div key={g.title} className="space-y-1">
              <div className="px-3 text-[10px] uppercase tracking-widest text-muted-foreground/70">{g.title}</div>
              {visible.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                      isActive ? "bg-sidebar-accent text-sidebar-primary font-medium shadow-sm"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    }`}>
                  <Icon className="h-4 w-4" />{label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="p-3 border-t border-sidebar-border space-y-2">
        <div className="text-xs text-muted-foreground px-2 truncate">{user?.email}</div>
        {roles.length > 0 && <div className="text-[10px] text-muted-foreground/70 px-2 truncate">{roles.join(' · ')}</div>}
        <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground" onClick={async () => { await signOut(); navigate("/auth"); }}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </div>
    </aside>
  );
}