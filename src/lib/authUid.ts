import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the currently authenticated user id straight from the auth server.
 * Guards against stale client-side sessions (refresh_token_not_found), which
 * otherwise cause RLS "new row violates row-level security policy" errors
 * because auth.uid() is NULL while the cached user object still has an id.
 */
export async function requireUid(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    await supabase.auth.signOut();
    throw new Error("Your session expired. Please sign in again.");
  }
  return data.user.id;
}
