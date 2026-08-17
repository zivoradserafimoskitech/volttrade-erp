import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Sidebar } from "./Sidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, Sun, Moon } from "lucide-react";

export function ErpLayout({ children, title, subtitle, actions }: { children: ReactNode; title: string; subtitle?: string; actions?: ReactNode }) {
  const { user, loading, needsMfa } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (needsMfa && location.pathname !== "/2fa") return <Navigate to="/2fa" replace />;

  return (
    <div className="min-h-screen flex w-full bg-background">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b border-border px-6 flex items-center justify-between bg-card/40 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden shrink-0" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <Sidebar mobile />
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
              {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}>
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            {actions}
          </div>
        </header>
        <div className="p-6 space-y-6 overflow-auto">{children}</div>
      </main>
    </div>
  );
}