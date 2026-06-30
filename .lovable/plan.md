## Octopus-style upgrades for Vatra (consumer portal)

Five new portal areas, all themed in the existing Ember palette and reachable from the Vatra top nav.

### 1. Account home redesign (`/portal`)
Reshape `Overview.tsx` around an Octopus-style account summary:
- Big **Balance** tile (credit / debit) with next direct-debit date and amount, pulled from `invoices` + `payments`.
- "Your energy this month" card: live month-to-date kWh, vs same month last year, vs forecast for the month.
- Tariff strip showing current plan + current unit rate (or live Agile price if on Agile).
- Quick links to Smart actions, Tariffs, EV charging, Refer a friend.

### 2. Agile / tracker tariff browser (`/portal/tariffs`)
- Today + tomorrow half-hourly price chart (bar chart, color-graded green→amber→red).
- "Current price" tile and "Cheapest 3 hours today/tomorrow" tile.
- 30-day price trend line.
- Available plans cards (Vatra Fixed, Vatra Tracker, Vatra Agile, Vatra Go for EV) with a "Switch to this tariff" CTA that writes a `tariff_switch_request`.
- Data source: existing `market_prices` table; fall back to a deterministic synthetic curve when the table is empty so the UI is never blank.

### 3. Smart actions & savings (`/portal/savings`)
New tables for opt-in demand-response style events:
- `saving_sessions` (window, baseline kWh, points-per-kWh saved, status).
- `saving_session_signups` (client opt-ins, measured reduction kWh, points awarded).
A page listing upcoming sessions with **Opt in** buttons, a live "session in progress" banner during the window, and a history table showing kWh saved + points earned per session. Total points + lifetime savings shown at the top.

### 4. Refer a friend & rewards (`/portal/refer`)
- Personal referral code generated per client and a copyable link.
- New tables `referrals` (referrer, referred email, status, credit_eur) and `rewards_ledger` (client, type, amount_eur, balance, note).
- Page shows referral link, status of pending/successful referrals, and a rewards ledger with running balance. Credits applied here also feed the Account home balance tile.

### 5. Intelligent EV charging (`/portal/ev`)
- Per-client EV vehicles: new `ev_vehicles` table (make/model, battery kWh, max charge kW, plug-in time, target SoC %, ready-by time).
- New `ev_charge_plans` table storing the optimised schedule: per-hour kW for the next 24h chosen from cheapest price slots that hit the target SoC by the deadline.
- Page lets the customer add a vehicle, set ready-by time + target SoC, and shows the generated schedule overlaid on the half-hourly price chart, with an estimated charge cost.
- Optimiser runs client-side (no edge function): greedy fill of cheapest half-hours from `market_prices` until the energy need is met.

### Branding & nav
- Add nav entries: Tariffs, Savings, Refer, EV — under the existing Vatra header. On mobile the nav already scrolls horizontally.
- Keep Space Grotesk + Ember palette; reuse `EMBER = #FF6B2C` and the existing chart styling so all new pages feel native to Vatra.

### Technical section

Files added:
- `src/pages/portal/PortalTariffs.tsx`
- `src/pages/portal/PortalSavings.tsx`
- `src/pages/portal/PortalRefer.tsx`
- `src/pages/portal/PortalEv.tsx`
- `src/lib/evOptimiser.ts` (greedy half-hour scheduler)

Files modified:
- `src/pages/portal/Overview.tsx` — balance tile, MTD card, current tariff strip, new quick links.
- `src/components/portal/PortalLayout.tsx` — add nav items + icons.
- `src/App.tsx` — register four new routes.

Database migration (single migration call, with GRANTs + RLS, scoped to `current_portal_client_id()`):
- `tariff_switch_requests`
- `saving_sessions`, `saving_session_signups`
- `referrals`, `rewards_ledger`
- `ev_vehicles`, `ev_charge_plans`

I'll ship the migration first (you'll approve it), then build the pages on top.
