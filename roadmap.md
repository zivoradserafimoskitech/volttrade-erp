
## Analytics service (Render) — 2026-09-03
- [x] Backfill market_price_history from market_prices (989 hours)
- [x] Trigger mirrors new market_prices rows into market_price_history
- [x] Train-now UI polls forecast_models/retrain_log (job registry is not durable)
- [x] Analytics service fails closed when VOLTTRADE_ANALYTICS_KEY is unset
- [ ] User: set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VOLTTRADE_ANALYTICS_KEY on Render
