// Regression guards for the cross-tenant bypass found in the 2026-09-01 audit.
//
// THE BUG
// -------
// `risk-metrics` and `optimize-hedge` run on the service-role key, so RLS does
// not apply to them. Both accepted `org_id` from the request body:
//
//     let orgId = body.org_id;
//     if (!orgId) { ...resolve from the Bearer token... }
//
// Supplying org_id therefore skipped authentication entirely. Two further
// functions -- `forecast-price` and `ingest-memo` -- had no Authorization
// handling at all. All five were then deployed by deploy-risk-module.yml with
// `--no-verify-jwt`, whose comment claimed they "authenticate callers
// internally".
//
// These are source-level assertions rather than integration tests. That is
// deliberate: the failure mode is a silent regression during a Lovable prompt,
// and a test that only runs when someone stands up a live project would not
// catch it. They are cheap, they run in CI on every push, and they fail loudly
// on the exact shapes that caused the bug.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const RISK_FUNCTIONS = [
  "risk-metrics",
  "optimize-hedge",
  "forecast-price",
  "ingest-memo",
  "quote-supply",
] as const;

const src = (fn: string) =>
  readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");

describe("risk edge functions — authentication", () => {
  it.each(RISK_FUNCTIONS)("%s authenticates before doing any work", (fn) => {
    const s = src(fn);
    expect(
      /authenticate\(\s*req/.test(s) || /auth\.getUser\(/.test(s),
      `${fn} does no caller authentication at all`,
    ).toBe(true);
  });

  it.each(["risk-metrics", "optimize-hedge", "ingest-memo"])(
    "%s never treats a body org_id as an identity",
    (fn) => {
      const s = src(fn);
      // The exact bypass shape: assign the body value straight into the
      // variable that later filters the query.
      expect(s).not.toMatch(/let\s+orgId\s*=\s*body\.org_id/);
      expect(s).not.toMatch(/const\s+orgId\s*=\s*body\.org_id\s*;/);
      // It must go through resolveOrg(), which checks membership and 403s on
      // a mismatch.
      expect(s).toMatch(/resolveOrg\(/);
    },
  );

  it("resolveOrg rejects a body org_id that is not the caller's", () => {
    const auth = readFileSync("supabase/functions/_shared/auth.ts", "utf8");
    const fn = auth.slice(auth.indexOf("export async function resolveOrg"));
    // A user caller's org comes from organization_members, not the argument.
    expect(fn).toMatch(/from\("organization_members"\)/);
    expect(fn).toMatch(/\.eq\("user_id", auth\.userId\)/);
    // And a disagreeing argument is refused rather than silently preferred.
    expect(fn).toMatch(/requestedOrgId\s*!==\s*orgId/);
    expect(fn).toMatch(/403/);
  });
});

describe("risk edge functions — deployment", () => {
  it("the deploy workflow does not disable the platform JWT gate", () => {
    const wf = readFileSync(
      ".github/workflows/deploy-risk-module.yml",
      "utf8",
    );
    // Mentioning the flag in a comment is fine; passing it to the CLI is not.
    const deployLines = wf
      .split("\n")
      .filter((l) => l.includes("functions deploy") && !l.trimStart().startsWith("#"));
    expect(deployLines.length).toBeGreaterThan(0);
    for (const l of deployLines) expect(l).not.toContain("--no-verify-jwt");
  });

  it.each(RISK_FUNCTIONS)("%s has verify_jwt = true in config.toml", (fn) => {
    const cfg = readFileSync("supabase/config.toml", "utf8");
    const at = cfg.indexOf(`[functions.${fn}]`);
    expect(at, `${fn} is absent from config.toml`).toBeGreaterThan(-1);
    // Read up to the next function block.
    const rest = cfg.slice(at);
    const next = rest.indexOf("[functions.", 1);
    const block = next === -1 ? rest : rest.slice(0, next);
    expect(block).toMatch(/verify_jwt\s*=\s*true/);
  });
});

describe("large-table reads are paginated, not .limit()ed", () => {
  // README rule 5. A Supabase project caps responses at max_rows (1000);
  // .limit(50000) lowers a ceiling that is already lower, so the read returns
  // a silent 1000-row prefix. These four were doing exactly that.
  const CALLERS = [
    "supabase/functions/validate-readings/index.ts",
    "supabase/functions/forecast-volumes/index.ts",
    "supabase/functions/sync-kimi-meters/index.ts",
    "supabase/functions/import-dso-reads/index.ts",
    "src/pages/balancing/Settlement.tsx",
    "src/pages/balancing/ForecastAccuracy.tsx",
    "src/pages/balancing/ImbalanceAllocation.tsx",
    "src/pages/balancing/LivePosition.tsx",
    "src/pages/Reconciliation.tsx",
    "src/pages/Dashboard.tsx",
    "src/pages/Forecasting.tsx",
    "src/pages/Invoices.tsx",
    "src/pages/SmartMeter.tsx",
  ];

  // Strip comments first. The repair comments in these files quote the very
  // calls they replaced (".limit(50000) returned 1000 rows"), so a naive scan
  // of the raw source reports the fix as the bug.
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each(CALLERS)("%s has no .limit() above the 1000-row cap", (path) => {
    const code = stripComments(readFileSync(path, "utf8"));
    const oversized = [...code.matchAll(/\.limit\((\d+)\)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n > 1000);
    expect(
      oversized,
      `.limit(${oversized.join(", ")}) will return 1000 rows, not what it asks for`,
    ).toEqual([]);
  });

  it.each(CALLERS)("%s uses fetchAllRows for its bulk reads", (path) => {
    expect(readFileSync(path, "utf8")).toMatch(/fetchAllRows/);
  });

  it.each(CALLERS)("%s orders every paged read", (path) => {
    // .range() paging over an unordered query can repeat or skip rows between
    // pages: Postgres gives no stable row order without an ORDER BY. Every
    // fetchAllRows call must therefore end in an .order(...).
    const code = stripComments(readFileSync(path, "utf8"));
    for (const m of code.matchAll(/fetchAllRows<[^>]*>\(\s*\(\)\s*=>([\s\S]*?)\n\s*,?\s*\{ label:/g)) {
      expect(m[1], `a fetchAllRows query in ${path} has no .order()`).toMatch(
        /\.order\(/,
      );
    }
  });
});
