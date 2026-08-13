// Phase 4 (audit P0-3): guards on the tenancy migration.
//
// The migration itself is SQL and is verified by the CI `migrations` job.
// What these tests protect is the INVARIANT SET — the rules a future edit
// could quietly break, where the failure mode is silent data leakage between
// organizations rather than an error.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const MIGRATION = "supabase/migrations/20260812120000_phase4_org_tenancy.sql";
const sql = readFileSync(MIGRATION, "utf8");

// Tables where user_id genuinely means "this human", not "this company".
const PERSON_SCOPED = [
  "user_roles",
  "notifications",
  "notification_preferences",
  "device_tokens",
  "consumer_applications",
];

describe("tenancy migration — ordering", () => {
  it("drops legacy ownership policies BEFORE renaming user_id", () => {
    // ALTER TABLE ... RENAME COLUMN rewrites dependent policy expressions in
    // place (they are stored as parse trees, not text). If the rename ran
    // first, a search for `user_id` would match nothing, every legacy
    // restrictive policy would survive, and the migration would report
    // success while silently blocking access.
    const dropAt = sql.indexOf("dropped legacy ownership policy");
    const renameAt = sql.indexOf("RENAME COLUMN user_id TO created_by");
    expect(dropAt).toBeGreaterThan(-1);
    expect(renameAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(renameAt);
  });

  it("matches BOTH column names, so it is safe to re-run after a partial apply", () => {
    const dropSection = sql.slice(0, sql.indexOf("RENAME COLUMN user_id TO created_by"));
    expect(dropSection).toContain("created_by");
    expect(dropSection).toContain("user_id");
  });
});

describe("tenancy migration — person-scoped tables are exempt", () => {
  for (const t of PERSON_SCOPED) {
    it(`${t} is excluded from the policy rewrite`, () => {
      const dropBlock = sql.slice(
        sql.indexOf("FOR p IN"),
        sql.indexOf("dropped legacy ownership policy"),
      );
      expect(dropBlock).toContain(`'${t}'`);
    });
  }

  it("none of them appear in the org_tables migration list", () => {
    const listBlock = sql.slice(
      sql.indexOf("org_tables text[] := ARRAY["),
      sql.indexOf("];", sql.indexOf("org_tables text[] := ARRAY[")),
    );
    for (const t of PERSON_SCOPED) expect(listBlock).not.toContain(`'${t}'`);
  });
});

describe("tenancy migration — ownership integrity", () => {
  it("organization_id is NOT NULL on every migrated table", () => {
    expect(sql).toContain("ALTER COLUMN organization_id SET NOT NULL");
  });

  it("created_by becomes nullable — a record must survive its author", () => {
    expect(sql).toContain("ALTER COLUMN created_by DROP NOT NULL");
    expect(sql).toContain("ON DELETE SET NULL");
  });

  it("re-keys unique constraints that included user_id", () => {
    // After the rename these would have been UNIQUE(created_by, ...), and
    // created_by is nullable — NULLs are distinct in a unique index, so a
    // scheduled run could insert unlimited duplicates.
    expect(sql).toContain("forecasts_org_client_date_key");
    expect(sql).toContain("UNIQUE (organization_id, client_id, forecast_date)");
    expect(sql).toContain("assets_org_code_key");
  });

  it("collapses pre-existing duplicates before enforcing the new key", () => {
    expect(sql).toContain("DELETE FROM public.forecasts f USING public.forecasts g");
  });

  it("keeps invoices write-locked to the billing function", () => {
    // Phase 2 removed the INSERT policy so only the server-side engine can
    // create invoices. The tenancy rewrite must not hand it back.
    const invoiceSection = sql.slice(sql.indexOf("org staff read invoices"));
    expect(invoiceSection).not.toMatch(/CREATE POLICY[^;]*ON public\.invoices\s+FOR INSERT/i);
  });

  it("scopes every new policy by organization", () => {
    const policies = sql.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    const orgPolicies = policies.filter((p) => /org staff/.test(p));
    expect(orgPolicies.length).toBeGreaterThan(0);
    for (const p of orgPolicies) {
      expect(p).toMatch(/current_org_id\(\)/);
    }
  });
});

describe("tenancy migration — helpers are hardened", () => {
  it("pins search_path on every SECURITY DEFINER function", () => {
    const fns = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$\$/g) ?? [];
    const definers = fns.filter((f) => /SECURITY DEFINER/i.test(f));
    expect(definers.length).toBeGreaterThan(0);
    for (const f of definers) expect(f).toMatch(/SET search_path\s*=\s*public, pg_temp/);
  });

  it("portal consumers are never organization members", () => {
    expect(sql).toContain("portal access is granted");
    const memberInsert = sql.slice(
      sql.indexOf("INSERT INTO public.organization_members"),
      sql.indexOf("ON CONFLICT DO NOTHING"),
    );
    // Enrolment is driven by user_roles (staff), never by portal_user_id.
    expect(memberInsert).toContain("user_roles");
    expect(memberInsert).not.toContain("portal_user_id");
  });
});

describe("frontend no longer stamps ownership", () => {
  it("org-table inserts do not send user_id", () => {
    const files = [
      "src/pages/Clients.tsx",
      "src/pages/Tariffs.tsx",
      "src/pages/BillingRuns.tsx",
      "src/pages/Payments.tsx",
      "src/pages/Schedules.tsx",
    ];
    for (const f of files) {
      expect(readFileSync(f, "utf8")).not.toContain("user_id: user");
    }
  });

  it("person-scoped inserts still do", () => {
    expect(readFileSync("src/pages/admin/UsersAdmin.tsx", "utf8")).toContain("user_id: userId");
  });
});
