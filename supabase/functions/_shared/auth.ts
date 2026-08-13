// P0-3 / P1-12 (audit): shared authentication for edge functions.
//
// THE BUG THIS FIXES
// ------------------
// Five sync functions did this:
//
//     const { data: { user } } = await userClient.auth.getUser();
//     if (!user) return 401;
//     ...  .eq("user_id", user.id)
//
// and `supabase/cron.sql` invokes them with the SERVICE ROLE key as Bearer.
// A service-role JWT has no `sub` claim, so GoTrue cannot resolve it to a user
// and `getUser()` fails — the scheduled sync returns 401 on every run and only
// the manual button in the UI ever works. Worse, the `.eq("user_id", ...)`
// filter means the job is scoped to whichever human happened to click it.
//
// THE MODEL
// ---------
// A function can be reached in two legitimate ways:
//
//   1. INTERACTIVE — a staff user's JWT. Scope work to what that user may see;
//      role checks apply.
//   2. AUTOMATED — pg_cron / another backend, presenting the service-role key.
//      There is no user. Scope work to EVERYTHING, because the scheduler acts
//      for the organisation, not for a person.
//
// `authenticate()` returns a discriminated union so the caller must handle
// both. It never silently treats a cron call as an anonymous user.
//
// SECURITY NOTES
// --------------
//  - The service-role key is compared with a timing-safe equality check.
//  - We compare against the key this function itself holds, so possessing it
//    already implies full database access — this is an identification step,
//    not a privilege grant.
//  - `verify_jwt` should stay TRUE in config.toml for every function using
//    this. Supabase accepts the service-role key as a valid JWT, so cron still
//    gets through the platform gate; this module then distinguishes the two.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.104.0";
import { captureError } from "./errors.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export type AuthResult =
  | { kind: "user"; userId: string; email: string | null; admin: SupabaseClient }
  | { kind: "service"; userId: null; email: null; admin: SupabaseClient };

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  // Deno has no crypto.timingSafeEqual for strings; compare fixed-width.
  if (a.length !== b.length) {
    // Still burn a comparison so length alone is not a fast path.
    let acc = 1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) acc |= 1;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new AuthError(`Server misconfigured: ${name} is not set`, 500);
  return v;
}

/**
 * Identify the caller. Throws AuthError on failure.
 *
 * @param req            the incoming request
 * @param opts.roles     when set and the caller is a USER, they must hold at
 *                       least one of these app_roles. Service callers bypass
 *                       role checks by design.
 */
export async function authenticate(
  req: Request,
  opts: { roles?: string[] } = {},
): Promise<AuthResult> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new AuthError("Unauthorized — missing Bearer token", 401);
  }
  const token = header.slice(7).trim();

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Path 2: automated caller presenting the service-role key ─────────────
  if (timingSafeEqual(token, serviceKey)) {
    return { kind: "service", userId: null, email: null, admin };
  }

  // ── Path 1: interactive user ─────────────────────────────────────────────
  const anonKey = env("SUPABASE_ANON_KEY");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) {
    throw new AuthError("Unauthorized — invalid or expired session", 401);
  }
  const user = data.user;

  if (opts.roles && opts.roles.length > 0) {
    const { data: roleRows, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (roleErr) throw new AuthError("Failed to resolve roles", 500);
    const held = (roleRows ?? []).map((r: { role: string }) => r.role);
    if (!held.some((r) => opts.roles!.includes(r))) {
      throw new AuthError(
        `Forbidden — requires one of: ${opts.roles.join(", ")}`,
        403,
      );
    }
  }

  return { kind: "user", userId: user.id, email: user.email ?? null, admin };
}

/** Standard JSON response with CORS headers. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Wrap a handler: CORS preflight, AuthError mapping, and a catch-all. */
export function handler(
  fn: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof AuthError) {
        return json({ ok: false, error: err.message }, err.status);
      }
      // Never leak internals to the client. P1-16 (audit): report it, rather
      // than logging into a void nobody reads at 03:00.
      console.error("Unhandled error:", err);
      captureError(err, {
        tags: { fn: new URL(req.url).pathname.split("/").pop() ?? "unknown" },
        extra: { method: req.method },
      });
      return json({ ok: false, error: "Internal error" }, 500);
    }
  };
}
