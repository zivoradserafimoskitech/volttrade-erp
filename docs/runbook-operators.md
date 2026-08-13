# VoltTrade ERP — operator runbook

For whoever runs the monthly cycle. Assumes no knowledge of the codebase.

The test this document has to pass: **if you were unavailable for two weeks,
could someone else bill the month from this page alone?**

---

## Monthly billing cycle

Run in this order. Steps 1–3 are prerequisites; skipping them produces wrong
invoices rather than errors.

### 1. Load the MEMO regulatory values — by the 5th working day

MEMO publishes the PPEE percentage and average price **per supplier, per
month**. They change every month.

Compliance → Regulatory charges → add rows for the billed month:

| Code | What |
|---|---|
| `PPEE_PERCENT` | your renewable obligation share for that month |
| `PPEE_PRICE` | regulated price, MKD/kWh |
| `MEMO_FEE` | market usage fee, MKD/MWh |
| `EUR_MKD` | FX rate used for the period |

**The system refuses to bill without them.** A billing run returns
`MISSING_MONTHLY_REGULATORY_VALUES` if `PPEE_PERCENT` or `PPEE_PRICE` has no
row for that month. That refusal is deliberate — a stale PPEE value mis-bills
every MK customer at once.

### 2. Import and validate meter readings

- DSO readings: Metering → Import DSO reads
- Private smart meters arrive automatically every 30 minutes

Then Metering → Validation. Nothing bills until it is validated. Readings
flagged by VEE are excluded automatically.

**Check the reading count looks sane.** A month of hourly data is ~744 rows per
metering point. If a point shows far fewer, the data is incomplete — find out
why before billing.

### 3. Confirm market prices are loaded

Market → Prices. You need a price for **every hour** of the period. Gaps are
priced at margin only and produce a warning on the invoice, not an error.

---

### 4. Create and preview the run

Billing → Billing runs → New. Set the period. Click **Run**.

Calculation happens on the server, so you can close the tab.

Read the result carefully:
- **Invoice count** — does it match your active contract count?
- **Skipped contracts** — each has a reason. "No consumption and no fixed fee"
  is normal for a dormant point; anything else deserves a look.
- **Warnings** — these are shown per contract. Do not issue past them without
  understanding each one.

Warnings you may see:

| Warning | Meaning |
|---|---|
| `N hours had no market price` | gaps in price data — load them and re-run |
| `scaled to the official DSO volume` | smart-meter shape scaled to the DSO total; normal when interval data is missing |
| `billed on own smart-meter volume` | **no official DSO data** — you are billing on internal data |
| `N meter counter reset(s) detected` | meter rolled over or was replaced; consumption across the reset is not recoverable |

**Re-running is safe.** Preview replaces only draft invoices; anything already
issued is protected.

### 5. Parity check — first time only, and after any engine change

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  deno run --allow-net --allow-env scripts/billing-parity.ts <start> <end>
```

Deltas under a cent are rounding. Anything larger means the old engine was
wrong — understand each line before issuing.

### 6. Issue

Billing → the run → **Issue invoices**.

This allocates invoice numbers and is **irreversible**. Numbers are gapless per
fiscal year and cannot be reused.

After issuing:
- Invoice financial content is frozen. Corrections = void and re-issue.
- The run cannot be deleted.

---

## Daily checks

### Sync health — Admin → Sync health

Four jobs should show recent successful runs:

| Job | Every |
|---|---|
| `sync-kimi-meters` | 30 min |
| `sync-asset-telemetry` | 15 min |
| `sync-gateway-alarms` | 5 min |
| `push-ems-plan` | 15 min |

If a timestamp is stale, check the detail:

```sql
select called_at, endpoint, status, detail
from public.external_api_log
where provider = 'volttrade-cloud'
order by called_at desc limit 10;
```

`detail->>'caller'` should read `service` for scheduled runs. If it says
`user`, only the manual button is working and the cron job is failing.

### Gateway alarms

Alarms mirror in from VoltTrade Cloud. **Acknowledge and resolve them in the
gateway UI, not here** — this is a read-only copy, and two systems both
claiming authority over alarm state is how an alarm ends up acknowledged in one
place and still active in the other.

---

## When something fails

### A scheduled job returns 401

The service-role call is not being recognised. Check the function logs in
Supabase. This exact failure ran silently for weeks before it was found — it
does not surface anywhere except the logs and a stale Sync health timestamp.

### `push-ems-plan` reports failures

```sql
select status, count(*) from public.asset_dispatch_schedules group by 1;
```

Rows in `failed` carry `last_error`. Common causes:

- `403 ... lacks the 'ems:write' scope` — wrong API key. The billing key cannot
  command plant; that is intentional. Use `GATEWAY_EMS_API_KEY`.
- `Gateway unreachable` — transient; the next tick retries.
- `exceeds the gateway limit of 500 setpoints` — dispatch resolution is too
  fine. Coarsen it.

Before any change to dispatch logic, dry-run it:

```bash
curl -X POST .../functions/v1/push-ems-plan \
  -H "Authorization: Bearer <staff JWT>" -d '{"dry_run": true}'
```

This reports setpoint counts, peak kW and clamping **without sending
anything**.

### An invoice is wrong

Do not edit it — issued invoices are immutable by design.

1. Find the run's snapshot:
   ```sql
   select engine_version, input_hash, warnings
   from public.billing_run_inputs
   where billing_run_id = '<run id>';
   ```
   `input_snapshot` holds every input the calculation used. This is how you
   answer a customer dispute months later.
2. Void the invoice: `update public.invoices set status = 'void' where id = ...`
3. Fix the underlying data, create a new run, issue.

### Something looks empty that should not

If staff see empty lists with no error, suspect tenancy:

```sql
select count(*) from public.organization_members;   -- every staff user?
select organization_id, count(*) from public.clients group by 1;
```

Ownership is `organization_id`. A row with the wrong one is invisible rather
than erroring.

---

## Escalation

| Symptom | Who |
|---|---|
| Wrong invoice amounts | Stop issuing. Preserve the snapshot. Developer. |
| Dispatch not reaching plant | Check `asset_dispatch_schedules.status`, then the gateway operator runbook |
| Gateway unreachable | Gateway operator runbook (`docs/runbook-operators.md` in that repo) |
| Sync 401 | Developer — service-role auth |

**Stop-the-line conditions.** Do not issue invoices if: the parity report shows
unexplained deltas; reading counts are far below expected; or the MEMO values
for the month are not loaded. Late invoices are recoverable. Wrong invoices
sent to customers are not.
