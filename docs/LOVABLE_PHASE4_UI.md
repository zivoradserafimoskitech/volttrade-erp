# Lovable prompt — Phase 4 UI (Alerts, Arbitrage, Battery)

Copy everything inside the fenced block below and paste it into Lovable as a
single prompt. It builds three Phase 4 features against the real database
schema (SPEC-phase4 v1.0, migration
`supabase/migrations/20260902090200_phase4_alerts_arbitrage.sql`).

**Important:** all three features read Supabase tables **directly** through
the existing Supabase client. Row Level Security already scopes rows to the
user's organisation — do NOT filter by `organization_id` yourself, and do
NOT create or call any edge function for these pages.

```
Build three new Phase 4 features in this VoltTrade app: an Alerts bell in
the header plus an /alerts page, an /arbitrage page, and a /battery page.
Match the existing app style (shadcn/ui cards, recharts, tailwind). Add nav
links "Arbitrage" and "Battery" next to the existing pages; the alerts bell
goes into the app header, visible on every page.

ALL DATA COMES FROM SUPABASE TABLES DIRECTLY via the existing Supabase
client (RLS already limits rows to the user's organisation — never filter
by organization_id, never call an edge function). If more than 1000 rows
could match, page with .range() in 1000-row steps.

FEATURE 1 — ALERTS BELL (header) + /alerts PAGE
-----------------------------------------------
Table: public.alerts
Columns: id (uuid), organization_id (uuid), created_at (timestamptz),
  kind (text: 'retrain_failure' | 'drift' | 'rollback' | 'promotion' |
  'arbitrage' | 'system'),
  severity (text: 'info' | 'warning' | 'critical'),
  title (text), body (text, nullable), data (jsonb, nullable),
  read_at (timestamptz, nullable — NULL means UNREAD)

Header bell:
- A bell icon button with a small badge showing the count of UNREAD alerts
  (read_at IS NULL). Hide the badge when the count is 0.
- Unread count query:
    supabase.from("alerts").select("id", { count: "exact", head: true })
      .is("read_at", null)
- Clicking the bell navigates to /alerts.
- Refresh the count silently every 60 seconds.

Alerts page (/alerts):
- Header row: title "Alerts", a severity filter (segmented control: All /
  Info / Warning / Critical — filter on the `severity` column, client-side
  or with .eq("severity", ...) when not "All"), and a "Mark all as read"
  button.
- List query:
    supabase.from("alerts")
      .select("id, created_at, kind, severity, title, body, data, read_at")
      .order("created_at", { ascending: false })
      .limit(100)
- Each row shows: a severity badge (info = neutral/blue, warning = amber,
  critical = red), the `kind` as a small uppercase tag, `title` in medium
  weight, `body` (when present) in muted text, and `created_at` formatted
  as "dd.MM.yyyy HH:mm". If `data` (jsonb) is present, show it collapsed
  behind a "details" disclosure rendered as pretty-printed JSON.
- Unread rows (read_at IS NULL) get a subtle highlighted background and a
  dot indicator.
- Mark-as-read: clicking a row (or its "mark read" action) sets read_at to
  the current timestamp:
    supabase.from("alerts").update({ read_at: new Date().toISOString() })
      .eq("id", <alert id>).is("read_at", null)
  "Mark all as read" does the same update without the id filter:
    supabase.from("alerts").update({ read_at: new Date().toISOString() })
      .is("read_at", null)
  Update local state optimistically and refresh the header badge count.
- Empty state: "No alerts yet — system events, retrain outcomes and
  arbitrage finds will show up here."

FEATURE 2 — ARBITRAGE PAGE (/arbitrage)
---------------------------------------
Table: public.arbitrage_opportunities
Columns: id (uuid), organization_id (uuid), detected_at (timestamptz),
  target_date (date), buy_zone (text), sell_zone (text),
  hour (integer, 0–23), buy_price (double precision, EUR/MWh),
  sell_price (double precision, EUR/MWh),
  spread_eur_mwh (double precision, EUR/MWh)

Query:
    supabase.from("arbitrage_opportunities")
      .select("target_date, buy_zone, sell_zone, hour, buy_price,
               sell_price, spread_eur_mwh, detected_at")
      .order("target_date", { ascending: false })
      .order("hour", { ascending: true })
      .limit(500)

Layout:
- Title "Cross-border arbitrage", subtitle "Profitable zone pairs found by
  the daily scan (spread ≥ 10 EUR/MWh)".
- A date switcher: Select populated from the distinct `target_date` values
  in the fetched rows (newest first), defaulting to the newest date.
- The table for the selected date, GROUPED by zone pair: one section per
  "buy_zone → sell_zone" pair (e.g. "MK → HU"), with the pair's rows as a
  table. Columns: Hour (`hour` formatted "HH:00"), Buy price (buy_zone,
  2 decimals, EUR/MWh), Sell price (sell_zone, 2 decimals), Spread
  (spread_eur_mwh, 2 decimals, EUR/MWh).
- Spread column emphasis: render the spread as a colored chip — green when
  ≥ 25 EUR/MWh, default otherwise. Sort each pair's rows by hour ascending.
- Best-per-day highlight: compute the row with the MAX spread_eur_mwh
  across ALL pairs of the selected date and highlight it (star icon + ring
  border + a "BEST" badge on the spread chip). If several rows tie,
  highlight all of them.
- Summary strip above the tables for the selected date: number of
  opportunities (row count), best spread (max spread_eur_mwh with its
  "buy_zone → sell_zone HH:00" label), and average spread (2 decimals).
- Empty state for a date with no rows: "No arbitrage opportunities for this
  date — spreads stayed below the threshold."

FEATURE 3 — BATTERY PAGE (/battery)
-----------------------------------
Table: public.bess_dispatch_schedules
Columns: id (uuid), organization_id (uuid), asset_id (uuid, nullable),
  delivery_date (date), hour_of_day (integer, 0–23),
  charge_mw (numeric), discharge_mw (numeric), soc_pct (numeric),
  price_forecast_eur_mwh (numeric, nullable),
  price_actual_eur_mwh (numeric, nullable), revenue_eur (numeric, nullable),
  created_at (timestamptz)

Query — TOMORROW's schedule (the daily job writes it around 14:30 UTC):
    supabase.from("bess_dispatch_schedules")
      .select("delivery_date, hour_of_day, charge_mw, discharge_mw,
               soc_pct, price_forecast_eur_mwh")
      .eq("delivery_date", <tomorrow's date as YYYY-MM-DD, local timezone>)
      .order("hour_of_day", { ascending: true })

Layout:
- Title "Battery — tomorrow's dispatch plan", subtitle showing the
  delivery_date formatted "dd.MM.yyyy".
- KPI row: total charge (sum charge_mw, MWh — 1 h blocks), total discharge
  (sum discharge_mw), end-of-day SoC (soc_pct of the last row, 1 decimal,
  "%"), and expected revenue (sum of revenue_eur when present, else show
  "—"), all formatted to 2 decimals where applicable.
- Main chart: a recharts ComposedChart with x axis = hour_of_day formatted
  "HH:00" (0–23):
  - Bar "Charge" = charge_mw in green, bar "Discharge" = -discharge_mw
    (NEGATED so discharge points DOWN) in blue — one shared value axis in
    MW with a zero reference line.
  - Line "SoC" = soc_pct on a right y-axis (0–100 %), amber, dots off.
  - Tooltip shows hour, charge, discharge, SoC and price_forecast_eur_mwh
    (EUR/MWh, 2 decimals) when present.
- Below the chart, a compact 24-row table: Hour, Charge (MW), Discharge
  (MW), SoC (%), Forecast price (EUR/MWh).
- Empty state (job hasn't run yet or no schedule for tomorrow): an info
  banner "No schedule for tomorrow yet — the daily optimisation runs at
  14:30 UTC." plus optionally the latest available delivery_date's data
  shown with a note of its date.

BEHAVIOR (all three features)
-----------------------------
- Fetch on mount; show a loading skeleton while fetching.
- Alerts bell count refreshes every 60 s; the /alerts page refetches every
  60 s silently. Arbitrage and Battery pages refetch every 5 minutes.
- Handle 401 by redirecting to the login page; other errors show a toast
  and keep the last good data on screen.
- Never expose or hard-code any API keys — the Supabase client handles
  auth via the user's session and RLS does the org scoping.
```
