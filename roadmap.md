
## Analytics service (Render) — 2026-09-03
- [x] Backfill market_price_history from market_prices (989 hours)
- [x] Trigger mirrors new market_prices rows into market_price_history
- [x] Train-now UI polls forecast_models/retrain_log (job registry is not durable)
- [x] Analytics service fails closed when VOLTTRADE_ANALYTICS_KEY is unset
- [ ] User: set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VOLTTRADE_ANALYTICS_KEY on Render

## Price history backfill — 2026-09-04
- [x] 3-year ENTSO-E day-ahead backfill for HU/RS/MK/GR/BG/SI/HR (~185k hours)
- [x] market_zone_for_source now derives the zone from any -xx source suffix (HR was mislabelled MK)
- [x] backfill-entsoe-history edge function (resumable, monthly windows) for future range top-ups
