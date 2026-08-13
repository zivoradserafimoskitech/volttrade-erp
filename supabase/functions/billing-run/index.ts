// P0-1 (audit): the billing run, moved out of the browser.
//
// WHAT THIS REPLACES
// ------------------
// `src/pages/BillingRuns.tsx execute()` fetched every input into the browser,
// computed every amount in floats, and inserted invoices one at a time in a
// loop with no transaction. Closing the tab mid-run left a partially issued
// period. RLS controlled who could write an invoice but never what it said, so
// the amounts were effectively client-supplied.
//
// WHAT THIS DOES
// --------------
//   preview: load inputs -> snapshot them -> run the pure engine -> replace
//            the run's draft invoices. Repeatable and side-effect-free with
//            respect to issued documents.
//   issue:   delegate to the issue_billing_run() SQL function, which allocates
//            gapless per-year numbers and flips statuses in ONE transaction.
//
// Invoices are created only here, under service_role. There is no INSERT
// policy for authenticated users on public.invoices any more.

import { authenticate, handler, json, AuthError } from "../_shared/auth.ts";
import {
  calculateBillingRun,
  type BillingInput,
  type IntervalReading,
} from "../_shared/billing-engine.ts";

// Bump when the calculation changes. Stored on every snapshot so an invoice
// can be reproduced with the engine that actually produced it.
const ENGINE_VERSION = "2.0.0";

const BILLING_ROLES = ["admin", "management", "billing_officer", "finance"];

Deno.serve(handler(async (req) => {
  const auth = await authenticate(req, { roles: BILLING_ROLES });
  const admin = auth.admin;

  const body = await req.json().catch(() => ({}));
  const runId: string | undefined = body.run_id;
  const action: string = body.action ?? "preview";
  if (!runId) return json({ ok: false, error: "run_id is required" }, 400);

  const { data: run, error: runErr } = await admin
    .from("billing_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (runErr) throw runErr;
  if (!run) return json({ ok: false, error: "Billing run not found" }, 404);

  if (action === "issue") return await issueRun(admin, run);
  if (action !== "preview") return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  return await previewRun(admin, run, auth.userId);
}));

// ─── preview ────────────────────────────────────────────────────────────────

async function previewRun(admin: any, run: any, userId: string | null) {
  if (run.status === "issued") {
    return json(
      { ok: false, error: "This run is already issued and cannot be recalculated. Create a new run." },
      409,
    );
  }

  const startISO = `${run.period_start}T00:00:00Z`;
  const endISO = `${run.period_end}T23:59:59Z`;

  // ── Load every input ──────────────────────────────────────────────────
  const [contracts, tariffs, clients, countries, links, intervals, registers, prices, regs] =
    await Promise.all([
      sel(admin, "supply_contracts", (q: any) => q.select("*").eq("status", "active")),
      sel(admin, "tariffs", (q: any) => q.select("*")),
      sel(admin, "clients", (q: any) => q.select("id,country_code")),
      sel(admin, "countries", (q: any) => q.select("code,vat_percent")),
      sel(admin, "supply_contract_points", (q: any) => q.select("*")),
      sel(admin, "consumption_readings", (q: any) =>
        q.select("metering_point_id,reading_at,actual_mwh,source,quality")
          .gte("reading_at", startISO).lte("reading_at", endISO)),
      sel(admin, "meter_readings", (q: any) =>
        q.select("metering_point_id,reading_at,import_kwh")
          .eq("validation_status", "validated")
          .gte("reading_at", startISO).lte("reading_at", endISO)),
      sel(admin, "market_prices", (q: any) =>
        q.select("delivery_at,price_eur_mwh,source")
          .gte("delivery_at", startISO).lte("delivery_at", endISO)),
      sel(admin, "regulatory_charges", (q: any) =>
        q.select("*").lte("valid_from", run.period_end)
          .or(`valid_to.is.null,valid_to.gte.${run.period_start}`)),
    ]);

  // ── Regulatory values, effective at the START of the period ───────────
  // The browser sorted by valid_from descending across rows filtered by
  // period_end, so a rate introduced mid-period was applied to the whole
  // period. Anchor on period_start instead.
  const regValue = (code: string, fallback: number) => {
    const rows = regs
      .filter((r: any) => r.code === code && r.valid_from <= run.period_start)
      .sort((a: any, b: any) => (a.valid_from < b.valid_from ? 1 : -1));
    return rows.length ? Number(rows[0].value) : fallback;
  };

  // MEMO publishes the PPEE share and average prices per supplier for EVERY
  // month (Прилог 1, т.5 — by the 5th working day), and the share differs by
  // supplier according to its consumption shape. The browser asked the
  // operator to confirm with window.confirm(); a server cannot, and a
  // dismissible prompt was never a real control. Refuse instead: a wrong PPEE
  // percentage produces a wrong invoice for every MK customer at once.
  const billedMonth = String(run.period_start).slice(0, 7);
  const monthly = ["PPEE_PERCENT", "PPEE_PRICE"];
  const stale = monthly.filter((code) => {
    const row = regs
      .filter((r: any) => r.code === code)
      .sort((a: any, b: any) => (a.valid_from < b.valid_from ? 1 : -1))[0];
    return !row || String(row.valid_from).slice(0, 7) !== billedMonth;
  });
  const force = run.notes?.includes("[FORCE_STALE_REGULATORY]") ?? false;
  if (stale.length > 0 && !force) {
    return json(
      {
        ok: false,
        error: "MISSING_MONTHLY_REGULATORY_VALUES",
        message:
          `${stale.join(" and ")} has no row for ${billedMonth}. MEMO publishes the PPEE ` +
          `percentage and average price per supplier each month (memo.mk, by the 5th working ` +
          `day). Billing with a stale value produces a wrong invoice for every MK customer. ` +
          `Add the ${billedMonth} rows in Compliance → Regulatory charges, then re-run.`,
        missing: stale,
        period: billedMonth,
      },
      422,
    );
  }

  const priceMap = new Map<string, number>();
  for (const p of prices) {
    priceMap.set(new Date(p.delivery_at).toISOString().slice(0, 13), Number(p.price_eur_mwh));
  }

  const input: BillingInput = {
    periodStart: run.period_start,
    periodEnd: run.period_end,
    contracts,
    tariffs,
    clients,
    countries,
    contractPoints: links,
    intervals: intervals as IntervalReading[],
    registers,
    priceMap,
    regulatory: {
      ppeePercent: regValue("PPEE_PERCENT", 12.96),
      ppeePriceMkdPerKwh: regValue("PPEE_PRICE", 5.5993826),
      memoFeeMkdPerMwh: regValue("MEMO_FEE", 14.1),
      eurMkd: regValue("EUR_MKD", 61.695),
    },
  };

  // ── Calculate ─────────────────────────────────────────────────────────
  const calc = calculateBillingRun(input);

  // ── Snapshot the inputs BEFORE writing anything ───────────────────────
  const snapshot = {
    ...input,
    priceMap: Object.fromEntries(priceMap), // Map is not JSON-serialisable
  };
  const inputHash = await sha256(JSON.stringify(snapshot));

  const { error: snapErr } = await admin.from("billing_run_inputs").insert({
    billing_run_id: run.id,
    engine_version: ENGINE_VERSION,
    input_snapshot: snapshot,
    output_snapshot: calc,
    input_hash: inputHash,
    warnings: calc.invoices.flatMap((i) => i.warnings).concat(calc.warnings),
  });
  if (snapErr) throw snapErr;

  // ── Replace this run's DRAFT invoices ─────────────────────────────────
  // The trigger blocks deletion of anything not in draft, so a previously
  // issued invoice can never be silently removed by a recalculation.
  const { error: delErr } = await admin
    .from("invoices")
    .delete()
    .eq("billing_run_id", run.id)
    .eq("status", "draft");
  if (delErr) throw delErr;

  const rows = calc.invoices.map((inv) => {
    const contract = contracts.find((c: any) => c.id === inv.contract_id);
    const due = new Date(run.period_end);
    due.setDate(due.getDate() + (contract?.payment_terms_days ?? 14));
    return {
      created_by: userId, // null for automated runs; no longer load-bearing
      organization_id: run.organization_id,
      client_id: inv.client_id,
      billing_run_id: run.id,
      invoice_number: null, // allocated at ISSUE time — see migration §2
      period_start: run.period_start,
      period_end: run.period_end,
      total_mwh: inv.total_mwh,
      energy_amount_eur: inv.energy_amount,
      margin_amount_eur: 0,
      total_eur: inv.total,
      tax_amount_eur: inv.tax_amount,
      currency: inv.currency,
      components: inv.lines,
      due_date: due.toISOString().slice(0, 10),
      status: "draft",
      doc_type: "invoice",
    };
  });

  let inserted = 0;
  if (rows.length > 0) {
    // Single batched insert: all-or-nothing per statement, rather than the
    // old per-invoice loop that could stop halfway.
    const { error, count } = await admin.from("invoices").insert(rows, { count: "exact" });
    if (error) throw error;
    inserted = count ?? rows.length;
  }

  const totals = calc.invoices.reduce(
    (a, i) => ({ eur: a.eur + i.total, mwh: a.mwh + i.total_mwh }),
    { eur: 0, mwh: 0 },
  );

  await admin
    .from("billing_runs")
    .update({
      status: "preview",
      invoice_count: inserted,
      total_eur: round2(totals.eur),
      total_mwh: round3(totals.mwh),
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  return json({
    ok: true,
    action: "preview",
    engine_version: ENGINE_VERSION,
    input_hash: inputHash,
    invoices: inserted,
    skipped: calc.skipped,
    total_eur: round2(totals.eur),
    total_mwh: round3(totals.mwh),
    warnings: calc.invoices
      .filter((i) => i.warnings.length > 0)
      .map((i) => ({ contract_id: i.contract_id, warnings: i.warnings })),
  });
}

// ─── issue ──────────────────────────────────────────────────────────────────

async function issueRun(admin: any, run: any) {
  if (run.status !== "preview") {
    return json(
      { ok: false, error: `Run must be in preview to issue (is: ${run.status}).` },
      409,
    );
  }
  // One transaction inside Postgres: numbers allocated and statuses flipped
  // together, or not at all.
  const { data, error } = await admin.rpc("issue_billing_run", { p_run_id: run.id });
  if (error) {
    return json({ ok: false, error: error.message }, 409);
  }
  return json({
    ok: true,
    action: "issue",
    issued: (data ?? []).length,
    invoices: data ?? [],
  });
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function sel(admin: any, table: string, build: (q: any) => any): Promise<any[]> {
  // Supabase caps a response at 1000 rows by default. A month of hourly
  // readings across a modest fleet blows straight past that, and the browser
  // version silently billed the truncated set. Page explicitly.
  const PAGE = 1000;
  let from = 0;
  const out: any[] = [];
  for (;;) {
    const { data, error } = await build(admin.from(table)).range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
    if (from > 500_000) {
      throw new Error(`Refusing to load more than 500k rows from ${table} — narrow the period.`);
    }
  }
  return out;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
