# VoltTrade Risk Module — setup runbook

For whoever installs the Risk & Analytics module on a fresh environment.
Assumes no knowledge of the codebase. Do the steps **in order** — each one
depends on the previous.

The test this document has to pass: **given only Supabase/Lovable/Render
dashboard access, can you get /risk/hedge showing a live recommendation?**

---

## 1. What the module is

| Piece | Where it lives | What it does |
|---|---|---|
| 4 UI pages | `/risk/hedge`, `/risk/metrics`, `/quote-builder`, forecast views in the app | trader-facing risk and quoting screens |
| 5 edge functions | `supabase/functions/{forecast-price, ingest-memo, optimize-hedge, risk-metrics, quote-supply}` | thin proxies + ingestion |
| 1 more edge function | `supabase/functions/retrain-nightly` | triggers the weekly model retrain |
| Python analytics service | `python-service/` (deployed on Render) | the math engine: forecasts, hedge optimisation, backtests, retraining |
| Database objects | `supabase/migrations/20260901090000_risk_module.sql` | 6 tables, 2 views, `shape_mask()`, column additions |

The edge functions do **no** heavy maths themselves — they forward to the
analytics service. If the analytics service is down, every page in this
module is down with it.

---

## 2. One-time setup

### 2.1 Apply the database migration

Two ways; pick one.

**A. GitHub Action (preferred).** Repo → Actions → *Deploy VoltTrade Risk
Module* → Run workflow. Tick "Apply risk-module migration". Requires the
GitHub secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_URL` (Session pooler
URI from Supabase Dashboard → Connect — the direct host is IPv6-only and
GitHub runners cannot reach it).

**B. SQL editor.** Supabase Dashboard → SQL Editor → paste the contents of
`supabase/migrations/20260901090000_risk_module.sql` → Run. The script is
idempotent; running it twice is safe.

Verify: `select count(*) from public.org_risk_settings;` must return a
number, not an error.

### 2.2 Point the frontend at the analytics service

In Lovable, set the environment variable:

```
VITE_VOLTTRADE_ANALYTICS_URL=https://volttrade-analytics.onrender.com
```

Redeploy the frontend afterwards — Vite bakes env vars in at build time.

### 2.3 Set the Supabase secrets

Supabase Dashboard → Edge Functions → Secrets (or the GitHub Action's
"Set Supabase secrets" toggle):

| Secret | Value |
|---|---|
| `VOLTTRADE_ANALYTICS_URL` | `https://volttrade-analytics.onrender.com` |
| `VOLTTRADE_ANALYTICS_KEY` | the analytics service API key (see §5 before reusing an old one) |

Also needed by the ingestion jobs: `ENTSOE_API_TOKEN` (free token from
transparency.entsoe.eu).

### 2.4 Deploy the edge functions

The GitHub Action deploys the 5 risk functions when "Deploy edge functions"
is ticked (with `--no-verify-jwt` — they predate the shared auth module and
do their own checks). Deploy `retrain-nightly` too:

```bash
supabase functions deploy retrain-nightly
```

Note the **absence** of `--no-verify-jwt`: `retrain-nightly` authenticates
callers internally via `supabase/functions/_shared/auth.ts`, so
`verify_jwt = true` stays on in `supabase/config.toml` as defence in depth.
The platform accepts the service-role key as a valid JWT, so the weekly cron
call still gets through.

If you schedule `sync-entsoe-prices` (§2.5 does), deploy it as well — it is
not among the 5 functions the Action deploys.

### 2.5 Schedule the cron jobs — run once

Open `supabase/cron.sql`, replace `<PROJECT_REF>`, `<SERVICE_ROLE_KEY>` and
`<ORG_ID>` (`select id from public.organizations;`), then run the whole file
**once** in the SQL Editor. It schedules:

| Job | Schedule (UTC) | Purpose |
|---|---|---|
| `ingest-memo` | daily 05:00 | MEMO day-ahead prices → `market_price_history` |
| `sync-entsoe-prices` | daily 13:45 | ENTSO-E day-ahead for HU (HUPX) and RS |
| `retrain-nightly` | Monday 02:00 (03:00 CET) | champion/challenger retrain + drift detection |

Inspect with `select * from cron.job;` — remove with
`select cron.unschedule('<name>');`.

---

## 3. Verification checklist

1. **Analytics service is up.** `GET {VOLTTRADE_ANALYTICS_URL}/health`
   returns `{"status":"ok","version":"2.1.0"}`. First call after idle takes
   ~25 s (see §4) — that is not a failure.
2. **Hedge page.** Open `/risk/hedge`. You should see a recommended hedge
   ratio, not an error toast.
3. **Quote builder.** Open `/quote-builder`, build a quote for a test client.
   The price curve should populate.
4. **Prices are landing.** After the first scheduled run:
   ```sql
   select source, max(delivery_at) from public.market_prices
    where source like 'entsoe-%' group by 1;
   select max(timestamp) from public.market_price_history where zone = 'MK';
   ```
5. **Cron calls are being accepted.**
   ```sql
   select called_at, endpoint, status
     from public.external_api_log
    order by called_at desc limit 10;
   ```
   Scheduled runs must show status 200. A wall of 401s means the
   service-role caller is not recognised — check the function logs.

---

## 4. Troubleshooting

**Every page fails, function logs show `ECONNREFUSED localhost:8000`.**
`VOLTTRADE_ANALYTICS_URL` is not set on the edge functions. They fall back
to `http://localhost:8000`, which is only right for local development.
Set the secret (§2.3) and redeploy the functions.

**The first request of the day takes 25+ seconds, then everything is fast.**
Render's free tier spins the analytics service down when idle; the first
call pays the cold start. Nothing to fix — tell traders to expect it, or
upgrade the Render plan if it matters.

**`relation "public.market_price_history" does not exist`** (or PostgREST's
`Could not find the table 'public.X' in the schema cache`).
The migration (§2.1) was never applied, or was applied to the wrong project.
Apply it, then reload the PostgREST schema cache:
`select pg_notify('pgrst', 'reload schema');`

**Cron job runs but nothing is ingested.**
For `ingest-memo`: the job body must carry the real org id — a leftover
`<ORG_ID>` placeholder returns 400. For `sync-entsoe-prices`: a missing
`ENTSOE_API_TOKEN` returns 400 with instructions in the body. Read the
function logs; both failures are loud there.

**Retrain reports `drift: true`.**
Recent forecast error is more than 10% worse than the trailing average.
Normal after a market regime change (new interconnectors, price caps). The
champion/challenger promotion handles it automatically; only investigate if
it persists for several weeks.

---

## 5. Security notes

- **Rotate the analytics key.** An old summary PDF circulating by e-mail
  contains the production `VOLTTRADE_ANALYTICS_KEY` in cleartext. Treat that
  key as compromised: generate a new one, set it on the Render service
  (`VOLTTRADE_ANALYTICS_KEY` env var) and in the Supabase secrets, and
  delete the PDF where you can.
- **`.env` is now gitignored.** A `.env` with Supabase credentials was
  committed historically. It stays in git history — if the keys in it were
  ever live, rotate them too — but `.gitignore` now blocks re-committing it.
- **Service-role key in `cron.sql`.** That file contains a placeholder for
  the service-role key. Never commit the filled-in version; it only ever
  belongs in the SQL Editor.
