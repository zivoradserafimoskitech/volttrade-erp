// Phase 4 (audit P1-16): error reporting for edge functions.
//
// The ERP had no error tracking at all. When a scheduled function failed at
// 03:00 — and several were failing every single run, silently, for weeks
// (P0-3) — nothing told anyone. /admin/sync-health showed a stale timestamp
// and that was it.
//
// Fire-and-forget, dependency-free, degrades to console when SENTRY_DSN is
// unset. An error reporter must never be able to break the function reporting
// through it.

interface Ctx {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  level?: "fatal" | "error" | "warning" | "info";
}

function dsn(): { url: string; key: string } | null {
  const raw = Deno.env.get("SENTRY_DSN");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return { url: `${u.protocol}//${u.host}/api/${u.pathname.replace(/^\//, "")}/store/`, key: u.username };
  } catch {
    return null;
  }
}

export function captureError(err: unknown, ctx: Ctx = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const type = err instanceof Error ? err.name : "Error";
  const target = dsn();
  if (!target) {
    console.error(`[error] ${type}: ${message}`, ctx.extra ?? "");
    return;
  }
  void fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=volttrade-erp/1.0`,
    },
    body: JSON.stringify({
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: new Date().toISOString(),
      platform: "javascript",
      level: ctx.level ?? "error",
      logger: "volttrade-erp",
      environment: Deno.env.get("ENVIRONMENT") ?? "production",
      tags: { runtime: "supabase-edge", ...ctx.tags },
      extra: ctx.extra,
      exception: { values: [{ type, value: message }] },
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

export function captureMessage(message: string, ctx: Ctx = {}): void {
  captureError(new Error(message), { ...ctx, level: ctx.level ?? "warning" });
}
