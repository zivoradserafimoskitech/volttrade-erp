# VoltTrade — Phase 1 Corrections + Phase 2/3 Build: Commit Guide

**What this pack is:** 12 files produced by auditing your repo against the implementation summary,
repairing what was broken, and building the missing Phase 2 forecasting + Phase 3 retrain code.
Everything was validated (Python compiles + smoke tests, SQL parsed against the real PostgreSQL
grammar, workflow YAML parsed, edge-function↔FastAPI contracts checked). Verdict: PASS (10/10 checks).

**Package:** `volttrade_phase2_pack.zip` → contains `repo-overlay/` with the 12 files at their
exact repo paths. Extract it over your local clone of `volttrade-erp` and commit.

---

## 1. The 12 files

| File | Status | What it is |
|---|---|---|
| `supabase/migrations/20260901090000_risk_module.sql` | NEW | The recovered + repaired DDL: 6 tables, RLS policies, `shape_mask()`, both views, 9 column additions, backfill. Fixed: invalid `CREATE POLICY IF NOT EXISTS` (×8), `wind_shape` double-`ELSE` |
| `.github/workflows/deploy-risk-module.yml` | REPLACE | Your uploaded workflow, repaired: valid YAML, psql via Session Pooler (fixes IPv6), independent job toggles, no deprecated `supabase login --token` |
| `.gitignore` | MODIFIED | Adds `.env` (your `.env` with Supabase keys is currently committed — stop future leaks; consider `git rm --cached .env`) |
| `supabase/cron.sql` | MODIFIED | 3 new jobs appended: `ingest-memo` (daily 05:00 UTC), `sync-entsoe-prices` HU+RS (daily 13:45 UTC), `retrain-nightly` (Mon 02:00 UTC). Existing 10 jobs untouched |
| `supabase/functions/retrain-nightly/index.ts` | NEW | Edge function proxying to the Python `/retrain` endpoint. Deploy **without** `--no-verify-jwt` (it authenticates internally) |
| `supabase/config.toml` | MODIFIED | `[functions.retrain-nightly] verify_jwt = true` stanza |
| `python-service/models/forecast_ensemble.py` | MODIFIED | Asinh transformation (spikes/negative prices, default ON), rolling 90-day training window, LightGBM transfer learning (pre-train HUPX → fine-tune MEMO, graceful MEMO-only fallback). Also fixes 2 pre-existing crash bugs in synthetic-data generation |
| `python-service/models/cross_market.py` | NEW | Cross-market features: HUPX/SEEPEX 24h lags, MEMO spreads, 7-day rolling means. NaN-safe when HU/RS data missing |
| `python-service/retrain/pipeline.py` + `__init__.py` | NEW | Champion-challenger retrain: trains challenger, backtests vs champion, promotes on ≥1% MAE improvement, drift alert at >10% degradation, writes `forecast_models` registry rows |
| `python-service/main.py` | MODIFIED | New `POST /retrain` endpoint (`?org_id=` query param); `/health` now reports `2.1.0` |
| `docs/RISK_MODULE_SETUP.md` | NEW | Operator runbook replacing the 7 missing docs (setup, verification, troubleshooting, security) |
| `python-service/ingest/backfill_history.py` | NEW | One-time ENTSO-E historical backfill: HUPX 15y, SEEPEX 8y, MEMO 2y → `market_price_history`. Resume-safe, retry/backoff, `--check-token` mode, CSV fallback |
| `supabase/functions/sync-entsoe-prices/index.ts` | MODIFIED | Adds required `Accept: application/xml` header — without it the ENTSO-E API returns an HTML page instead of data |

## 2. How to commit

```bash
cd volttrade-erp
unzip /path/to/volttrade_phase2_pack.zip
cp -r repo-overlay/* .
git add -A
git commit -m "Risk module: repaired migration+workflow, Phase 2 forecasting (asinh/transfer/cross-market), retrain pipeline, cron schedules"
git push origin main
```
(Lovable will two-way sync this. Don't prompt Lovable while the push is in flight.)

## 3. After committing — the one-time actions (in order)

1. **Rotate the analytics key** — the old one is exposed in the summary PDF. Put the new key
   on the Render service (`VOLTTRADE_ANALYTICS_KEY`) and use the new value everywhere below.
2. **Render env vars** — the Python service now also uses `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (for model-registry persistence; it degrades gracefully without
   them, but champion-challenger won't persist). Add both on Render.
3. **GitHub secrets** (repo → Settings → Secrets → Actions): `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_DB_URL` (**Session pooler** URI, not the direct host), `VOLTTRADE_ANALYTICS_URL`,
   `VOLTTRADE_ANALYTICS_KEY` (new key).
4. **Run the Action** → Deploy VoltTrade Risk Module → Run workflow (deploys 5 functions,
   applies the migration, sets secrets).
5. **Deploy the two functions the Action doesn't cover:**
   `supabase functions deploy retrain-nightly` and `supabase functions deploy sync-entsoe-prices`
   (the latter was already in your repo but never deployed).
6. **Lovable:** set `VITE_VOLTTRADE_ANALYTICS_URL = https://volttrade-analytics.onrender.com`.
7. **cron.sql:** paste into the Supabase SQL Editor once, replacing `<PROJECT_REF>`,
   `<SERVICE_ROLE_KEY>`, and the new `<ORG_ID>` placeholder
   (`select id from public.organizations;`).
8. **ENTSO-E + backfill (feeds the ML models real data):**
   - Add your ENTSO-E token as a Supabase secret named `ENTSOE_API_TOKEN`
   - Validate it: `python3 python-service/ingest/backfill_history.py --check-token --token <your-token>`
   - Run the one-time backfill (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `--org-id`):
     `python3 python-service/ingest/backfill_history.py --org-id <uuid> --token <your-token>`
     (~10–20 min for HUPX 15y + SEEPEX 8y + MEMO 2y; safe to re-run — it resumes)
   - Note: the ENTSO-E platform returned HTTP 503 during development; if `--check-token`
     says "platform unavailable", just retry later.

## 4. Verify

- `curl https://volttrade-analytics.onrender.com/health` → `"version":"2.1.0"` (allow ~30s cold start)
- App: `/risk/hedge` shows hourly position; `/quote-builder` prices by capture factor
- Supabase: `select * from cron.job;` shows 13 jobs; `external_api_log` shows 200s after the first runs
- After the first Monday 02:00 UTC run: `forecast_models` has a row with `is_active = true`

## 5. Known limitations (be aware)

- **Phase 2 code is new and untested against real data.** The retrain pipeline was smoke-tested
  with synthetic/stubbed data only. Watch the first real runs.
- **Transfer learning needs HUPX history** in `market_price_history` — until ENTSO-E ingestion
  has run for a while (or you backfill), it silently falls back to MEMO-only training. That's
  by design, not a bug.
- **Still not built** (Phase 3 advanced, from the original roadmap): BESS MPC with live
  forecasts, portfolio CVaR optimization, cross-market arbitrage detector, Slack/email alerts
  on retrain failure. The audit also found the "multi-market forecast ensemble" and "A/B testing
  framework" from the old summary were never actually written — the retrain pipeline in this
  pack provides the champion-challenger foundation they would have used.
