# VoltTrade ERP

Supplier and trading ERP for the Macedonian and wider SEE electricity market.
Handles the commercial side of an electricity supply business: clients, supply
contracts, metering, billing, balancing, settlement, trading and a consumer
portal.

Paired with **VoltTrade Cloud** (`gateway-monitoring-platform`) — the SCADA/EMS
layer that ingests field telemetry and executes dispatch. The two are separate
applications joined by an authenticated REST API; neither is the other's
backend. See [Integration](#integration).

---

## Stack

| | |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind, shadcn/ui |
| Backend | Supabase (Postgres 15, RLS, Edge Functions on Deno) |
| Built with | Lovable — **two-way GitHub sync on `main`** (see [Working on this](#working-on-this)) |
| Tests | Vitest |
| CI | GitHub Actions — typecheck, strict gate, tests, build, audit, migrations |

66 tables, 25 edge functions, ~65 routes.

---

## What it does

**Commercial** — clients, supply contracts, tariffs (fixed and indexed), PPA,
counterparties, trading contracts.

**Metering** — official DSO readings and private smart-meter data held
separately. DSO is the legal billing truth; smart-meter data drives shape,
forecasting and analytics. Readings pass a VEE validation stage before they can
be billed.

**Billing** — periodic billing runs producing invoices with the Macedonian
structure: indexed or fixed energy, PPEE renewable obligation, MEMO market fee,
VAT. Calculation is **server-side and reproducible** (see [Billing](#billing)).

**Balancing** — SLP profile synthesis for sub-40 kW consumers, day-ahead
scheduling and nomination, live position, imbalance allocation per client,
forecast accuracy (MAPE), dual-actual settlement.

**Assets** — BESS and PV monitoring, dispatch scheduling, and EMS plan push to
the plant via VoltTrade Cloud.

**Portal** — consumer-facing invoices, hourly consumption, savings, EV, PPA,
referrals.

---

## Billing

The part to understand before changing anything.

Invoice calculation lives in the `billing-run` **edge function**, not in the
browser. `src/pages/BillingRuns.tsx` is a thin client that triggers it and
renders the result.

Four properties hold by construction, enforced by property tests in
`src/test/billing.test.ts`:

```
sum(line.amount) === subtotal
sum(line.vat)    === tax_amount
subtotal + tax   === total
```

- **Money is exact.** Integer minor units via
  `supabase/functions/_shared/money.ts`. Never floats. One rounding policy
  (half away from zero), applied once.
- **VAT is rounded per line**, and the invoice tax is their sum — the only
  policy under which a printed invoice adds up read column-wise.
- **Runs are reproducible.** Every run snapshots its complete inputs into
  `billing_run_inputs` with a hash and the engine version. An invoice can be
  re-derived years later.
- **Issuing is atomic.** `issue_billing_run()` allocates gapless per-fiscal-year
  numbers and flips statuses in one transaction. Drafts carry no number.
- **Issued invoices are immutable.** Financial fields are frozen by trigger;
  corrections mean void and re-issue.
- **The browser cannot create invoices.** There is deliberately no INSERT policy
  on `invoices` for authenticated users.

Before issuing against a period you have billed before, run the parity report:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  deno run --allow-net --allow-env scripts/billing-parity.ts 2026-07-01 2026-07-31
```

---

## Integration

One authenticated seam to VoltTrade Cloud, over `/api/v1` with scoped API keys.

| Direction | Function | Purpose |
|---|---|---|
| pull | `sync-kimi-meters` | settlement energy → `meter_readings`, `consumption_readings` |
| pull | `sync-asset-telemetry` | BESS/PV telemetry → `asset_telemetry` |
| pull | `sync-gateway-alarms` | alarm mirror → `gateway_alarms` (read-only) |
| **push** | `push-ems-plan` | `asset_dispatch_schedules` → EMS plan at the plant |

`push-ems-plan` closes the control loop: price signal → optimisation → physical
setpoint → measured result → settlement.

**Two separate API keys, deliberately.** `GATEWAY_API_KEY` is read-only;
`GATEWAY_EMS_API_KEY` carries `ems:write` and can charge or discharge a
battery. The billing credential must not be able to move power.

Links: `metering_points.kimi_meter_id` and `assets.gateway_device_id` hold the
device ids.

---

## Tenancy and access

Ownership is `organization_id`. `created_by` records who made a row and does
**not** govern visibility — do not filter by it.

Access is `is_staff()` plus `has_any_role()` across nine roles. All 66 tables
have RLS enabled. Portal consumers are scoped through `clients.portal_user_id`
and are never organization members.

---

## Local development

```bash
bun install
cp .env.example .env.local        # add your Supabase URL and anon key
bun run dev
```

```bash
bun run test              # vitest
bun run typecheck         # tsc -b
bun run typecheck:strict  # full strict on the allowlist — must stay green
```

### Database and functions

Lovable does **not** run migrations or deploy edge functions. Use the CLI:

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy billing-run
```

Scheduled jobs live in `supabase/cron.sql` — run once in the SQL editor after
substituting your project ref and service-role key.

Required secrets: `GATEWAY_API_URL`, `GATEWAY_API_KEY`, `GATEWAY_EMS_API_KEY`,
`LEAD_THROTTLE_SALT`, `SENTRY_DSN`, plus the Influx variables for the
third-party forecast feed.

---

## Working on this

This project is Lovable-connected with **two-way sync on `main` only**. Every
prompt in Lovable commits to `main`. On conflict, GitHub wins.

Practical consequences:

- Work on branches; merge to `main` when you want Lovable to see it.
- Don't prompt Lovable while a merge is in flight.
- CI is the real guardrail. If a change breaks an invariant, the tests fail.

**Rules for any AI agent working in this repo** — these are not style
preferences, they are correctness:

1. Never calculate invoice amounts in the browser.
2. Never use floating-point arithmetic for money — use `_shared/money.ts`.
3. Never insert into `invoices` from the client.
4. Ownership is `organization_id`, not `user_id`.
5. Unpaginated Supabase selects cap at **1000 rows** — always paginate over
   readings, prices and telemetry. A silently truncated billing run
   under-bills every customer.

---

## Operations

See [`docs/runbook-operators.md`](docs/runbook-operators.md) for the monthly
billing cycle, sync health checks, and what to do when a scheduled job fails.
