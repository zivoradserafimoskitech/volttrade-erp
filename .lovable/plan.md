## Supply business expansion — 3 modules

Add a new sidebar group **Supply Operations** with three pages plus a separate customer-facing portal route.

---

### 1. Customer Onboarding / KYC (`/supply/onboarding`)

Pipeline: **Lead → Qualified → Quote → Contract Sent → KYC → Activated → Lost**.

- Kanban board (drag between stages) + table view toggle.
- "New lead" dialog: company name, contact, expected annual MWh, source (web/referral/cold/switch-in), assigned owner.
- Lead drawer with tabs:
  - **Quote** — pick tariff template, contract term, margin €/MWh → auto-calc indicative annual cost; "Generate quote PDF".
  - **KYC documents** — upload company registration, ID of signatory, proof of address, last 12 months of invoices (storage bucket `kyc-docs`, private). Status per doc: pending/approved/rejected with reviewer note.
  - **Contract** — generate supply contract PDF from quote + KYC; e-sign placeholder; once signed → "Activate" creates a `clients` row + `supply_contracts` + initial EDU shell.
- KPI tiles: pipeline value (€), conversion rate, avg days to close, KYC backlog.

### 2. Switching / Change-of-supplier (`/supply/switching`)

Two queues: **Switch-in** (gaining) and **Switch-out** (losing).

- Each row: EDU code, current/new supplier, requested date, DSO message status (REQ_SENT → ACK → CONFIRMED / REJECTED), gain/loss volume estimate, win-back flag.
- Actions: send DSO request (stub edge function `dso-switch-message` generating a message envelope), import DSO response (CSV upload), trigger **win-back** workflow on switch-out (assigns task to retention owner + logs offered discount).
- Monthly gain/loss chart, churn rate KPI, top loss reasons.
- Auto-creates a contract record on confirmed switch-in; flips contract status to `terminated` on confirmed switch-out.

### 3. Customer Self-Service Portal (`/portal` — separate layout)

Public route (still auth-gated, but with `customer` role and a stripped-down layout — no ERP sidebar). End-customers see only their own data via RLS keyed on `clients.portal_user_id`.

Pages:
- `/portal` — overview: contract summary, next invoice due, last 12-month consumption chart.
- `/portal/edus` — list of own EDUs with monthly consumption.
- `/portal/invoices` — download PDFs, see paid/unpaid.
- `/portal/readings` — submit self-reads (writes to `meter_readings` with `source='customer'`, `is_estimated=false`, validation gates from existing MeterReadings page).
- `/portal/profile` — update contact details, change password.

Add new app role `customer`. Portal layout (`PortalLayout`) hides admin nav entirely.

---

### Data changes

New tables:
- `leads` (company, contact, stage, owner, est_mwh, source, lost_reason, converted_client_id)
- `lead_quotes` (lead_id, tariff_id, term_months, margin_eur_mwh, annual_cost_eur, pdf_url, status)
- `kyc_documents` (lead_id, doc_type, file_path, status, reviewer_note, reviewed_by, reviewed_at)
- `switch_requests` (edu_code, direction in/out, current_supplier, new_supplier, requested_date, dso_status, confirmed_date, volume_estimate_mwh, win_back_offered, lost_reason)

New columns:
- `clients.portal_user_id uuid` (FK to auth.users, nullable) — links a customer login to their company record.

New role: `customer` added to `app_role` enum.

New storage bucket: `kyc-docs` (private, RLS — only owner + supply_manager/admin can read).

New edge function: `dso-switch-message` (stub that builds an XML envelope and stores it for download).

RLS: leads/quotes/kyc/switches → `supply_manager`, `management`, `admin` full access. Portal tables (clients/invoices/meter_readings/metering_points) get extra policies allowing access where `auth.uid() = clients.portal_user_id`.

---

### Build order

1. Migration: enum + tables + RLS + grants + portal policies + storage bucket.
2. `src/pages/supply/Onboarding.tsx` (kanban + drawer).
3. `src/pages/supply/Switching.tsx` (queues + DSO actions).
4. `src/components/portal/PortalLayout.tsx` + 5 portal pages.
5. Routes in `App.tsx`, sidebar entries for staff pages, "Invite to portal" button on Customers page (generates magic link, sets `portal_user_id`, grants `customer` role).
6. Edge function stub for DSO messages.

Approve and I'll ship it.