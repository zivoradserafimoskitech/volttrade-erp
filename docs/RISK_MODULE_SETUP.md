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

---

## 6. Historical data backfill

The nightly `sync-entsoe-prices` job only keeps a rolling window of a few
days. Before `retrain-nightly` output can be trusted, the ML models need
real history in `market_price_history` — run the one-time backfill:
`python-service/ingest/backfill_history.py` (stdlib + `requests` only).

**1. Get an ENTSO-E token.** Register at transparency.entsoe.eu, then
e-mail the transparency helpdesk asking for "Restful API access" for that
account; the token arrives in the reply (see "2.3 Set the Supabase secrets").

**2. Set `ENTSOE_API_TOKEN` as a Supabase secret** (Dashboard → Edge
Functions → Secrets). The daily `sync-entsoe-prices` job needs it too — the
backfill only covers history, not the rolling feed.

**3. Run the backfill once** (HU/HUPX 15 years, RS/SEEPEX 8 years,
MK/MEMO 2 years, monthly chunks, upserted in batches of 500):

```bash
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role key>
export ENTSOE_API_TOKEN=<token from step 1>
python3 python-service/ingest/backfill_history.py \
  --org-id <ORG_UUID> --zones HU,RS,MK
```

Expected duration: ~10-20 minutes for all three zones (~370 monthly API
requests with the default 2 s delay). Use `--check-token` first for a quick
verdict (token OK / token rejected / platform unavailable). If the Supabase
env vars are missing the script writes per-zone CSVs to `./backfill_out`
instead and says so loudly in the logs.

**Resume:** the script is idempotent and resumable. Before starting a zone
it reads the newest stored `timestamp` for that zone (from Supabase, or
from the CSV's last row in CSV mode) and continues from the next hour, so
a failed run can simply be re-launched. Pass `--start YYYY-MM-DD` to force
a full re-pull instead. Failed zones abort with a clear error after the
retry budget and do not block the other zones.

**Only trust `retrain-nightly` after this backfill has completed** — before
that, the models train on the thin rolling window (or synthetic MEMO data)
and the champion/challenger metrics are meaningless.

---

## Load forecasting (ML)

Tier-1 **portfolio load forecasting** complements the price ensemble: a
LightGBM **quantile** model (three boosters, `objective='quantile'`,
alpha 0.1/0.5/0.9) predicts hourly portfolio load as **P10/P50/P90 MW
bands** for nomination sizing and imbalance-risk checks. Features:
calendar (hour/DoW/month sin-cos, weekend, MK tariff day-type WD/SA/SU,
public holidays), optional Open-Meteo temperature (+temp², temp×hour) and
optional zonal load (+24h lag) from `load_history`. Registry rows use
`model_type='lightgbm_load'` in `forecast_models`.

> **Scope note:** ML load forecasting **complements, not replaces** SLP
> settlement — sub-40 kW consumers are still settled on standard load
> profiles by the DSO regardless of the ML forecast.

**1. Zonal load backfill (ENTSO-E A65 Actual Total Load).** Same script as
the price backfill, one extra flag (MK 4y / HU 10y / RS 8y windows, rows
land in `load_history`, or `load_<zone>.csv` in CSV mode):

```bash
python3 python-service/ingest/backfill_history.py \
  --document A65 --load-zones MK,HU,RS --org-id <ORG_UUID>
```

**2. Retrain.** The nightly job now runs with `model_kind=all` (price +
load). Manually, against the analytics service:

```bash
curl -X POST "$ANALYTICS_URL/retrain?org_id=<ORG_UUID>&model_kind=all" \
  -H "X-API-Key: $VOLTTRADE_ANALYTICS_KEY"
# -> {"job_id": "...", "status": "accepted", "model_kind": "all"}  (async)
curl "$ANALYTICS_URL/retrain/status?job_id=<JOB_ID>" \
  -H "X-API-Key: $VOLTTRADE_ANALYTICS_KEY"
```

**3. Forecast.** `POST /forecast/load?org_id=<ORG_UUID>&horizon_hours=48`
returns `{"forecast": [{timestamp, p10_mw, p50_mw, p90_mw}, ...], "model",
"source": "champion"|"adhoc"}`. Without an active load champion the service
trains ad-hoc on the fly; without Supabase data it falls back to a loudly
logged synthetic 10 GWh/yr portfolio.

---

## Forecast accuracy tracking

Answers the question *"how wrong were our forecasts, actually?"* — for both
the price ensemble and the LightGBM load model, per zone, over a rolling
window. Analysis only: errors are plain EUR/MWh or MW numbers, no money,
no invoicing.

### The pieces

| Piece | Where it lives | What it does |
|---|---|---|
| Table `forecast_predictions` | `supabase/migrations/20260902090000_forecast_tracking.sql` | one row per issued forecast point: when it was issued (`created_at`), the hour it targets (`target_time`), zone, model kind, the P10/P50/P90 quantiles, and — once known — the `actual` value |
| View `v_forecast_accuracy` | same migration | rolling **last-30-day** aggregates per organisation + model kind + zone |
| Prediction logging | `python-service/tracking/predictions.py`, called from `POST /forecast/load` | every load forecast the service issues is written to the table (best-effort; a logging failure never breaks a forecast response) |
| Scorer | `POST /score-forecasts` on the analytics service | fills in `actual` for predictions whose target hour has passed (with a 2 h grace for data landing) |
| Scorer trigger | `supabase/functions/sync-entsoe-prices` | after each successful price upsert it pings `/score-forecasts` fire-and-forget — so scoring rides along with the daily ENTSO-E sync, no extra cron needed |
| Read API | `supabase/functions/forecast-accuracy` | edge function behind staff auth; feeds the Accuracy page (see `docs/LOVABLE_ACCURACY_UI.md`) |

### The scorer flow

1. `sync-entsoe-prices` runs on its daily schedule and upserts fresh
   day-ahead prices.
2. Right after a successful upsert it POSTs
   `$VOLTTRADE_ANALYTICS_URL/score-forecasts` with the usual
   `X-API-Key: $VOLTTRADE_ANALYTICS_KEY` header. If either secret is unset
   the trigger is skipped silently; if the scorer is down the sync still
   reports success (a warning lands in the function logs).
3. The scorer picks up every prediction with `actual IS NULL` whose target
   hour is at least 2 hours in the past, looks up the realised value
   (`market_price_history` for price, `load_history` for load), and writes
   `actual` + `scored_at`. Predictions with no realised data yet simply
   wait for the next run.
4. `v_forecast_accuracy` and the `forecast-accuracy` edge function pick the
   new numbers up on their next read — nothing else to schedule.

### The metrics, in plain language

All metrics compare the **P50** (median) forecast against the actual value.
All are computed per organisation, model kind and zone over the last 30
days of scored rows.

| Metric | What it tells you |
|---|---|
| **MAE** | average absolute error — "on a typical hour we were off by this much" (EUR/MWh or MW) |
| **RMSE** | like MAE but punishes big misses harder — watch the RMSE/MAE gap for outlier hours |
| **sMAPE** | the same error expressed as a **percentage** of the actual/forecast magnitude — comparable across zones and across price vs load |
| **Bias** | average signed error — consistently positive means we under-forecast, negative means we over-forecast |
| **P10–P90 coverage** | how often the actual landed **inside** the predicted band, in %. Around 80% means the uncertainty band is honest; much lower means the band is too narrow |

### Verifying it works

```sql
-- predictions are being logged
select model_kind, zone, count(*), count(actual) as scored
  from public.forecast_predictions group by 1, 2;

-- the rolling view
select model_kind, zone, n, round(mae::numeric, 2) as mae,
       round(smape::numeric, 1) as smape_pct,
       round(bias::numeric, 2) as bias,
       round(coverage_p10_p90::numeric, 1) as coverage_pct
  from public.v_forecast_accuracy;
```

The first rows only appear after a forecast has been issued **and** its
target hour is at least 2 hours past **and** the scorer has run — so on a
fresh install expect meaningful numbers from the day after go-live, not
the same afternoon.

## Self-improvement loop (v2.4.0)

After every daily `/score-forecasts` call (chained from sync-entsoe-prices), the service
evaluates LIVE drift per model kind (7d vs 30d MAE from scored `forecast_predictions`,
>10% degradation, n>=24 in both windows). On drift: (1) `maybe_rollback` restores the
previous champion if one exists (`forecast_models.previous_champion_id`), then (2) an
immediate retrain launches for that kind (trigger=live_drift) — no waiting for Monday.
Every retrain run is logged in `retrain_log`; after 2 consecutive runs without promotion,
the challenger self-tunes LightGBM hyperparameters (3 combos, best by backtest MAE).
Promotion metadata: `promoted_at`, `previous_champion_id`, `promotion_reason`
('challenger_won' | 'rollback'). Apply migration `20260902090100_self_improve.sql` after
`20260902090000_forecast_tracking.sql`.
