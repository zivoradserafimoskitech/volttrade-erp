import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = 'admin'|'management'|'trader'|'supply_manager'|'billing_officer'|'finance'|'risk_officer'|'operations'|'auditor';
type Ctx = { user: User | null; session: Session | null; loading: boolean; roles: AppRole[]; hasRole: (r: AppRole|AppRole[]) => boolean; refreshRoles: () => Promise<void>; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ user: null, session: null, loading: true, roles: [], hasRole: () => false, refreshRoles: async () => {}, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) { setRoles([]); return; }
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', uid);
    const rs = (data ?? []).map((r: any) => r.role as AppRole);
    setRoles(rs);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
      setTimeout(() => loadRoles(s?.user?.id), 0);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      loadRoles(data.session?.user?.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const hasRole = (r: AppRole | AppRole[]) => {
    const arr = Array.isArray(r) ? r : [r];
    return arr.some(x => roles.includes(x));
  };

  return (
    <AuthCtx.Provider value={{
      user: session?.user ?? null, session, loading, roles, hasRole,
      refreshRoles: () => loadRoles(session?.user?.id),
      signOut: async () => { await supabase.auth.signOut(); setRoles([]); },
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);