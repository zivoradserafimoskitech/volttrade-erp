# Lovable prompt — "Accuracy" page (forecast accuracy tracking)

Copy everything inside the fenced block below and paste it into Lovable as a
single prompt. It builds an `/accuracy` page against the real backend
contract (`supabase/functions/forecast-accuracy`, SPEC-accuracy v1.0).
The page reads two data sources: the edge function for aggregated KPIs, and
the `forecast_predictions` table (through the existing Supabase client, RLS
already scopes it to the user's org) for the hourly chart series.

```
Build a new page called "Accuracy" at route /accuracy in this VoltTrade app.
It shows how accurate our ML forecasts (price and load) have been. Match the
existing app style (shadcn/ui cards, recharts, tailwind). Add a nav link
"Accuracy" next to the existing risk pages.

PAGE LAYOUT
-----------
Top bar: title "Forecast accuracy", plus two switchers:
1. model_kind switcher — segmented control with options "Price" (value
   "price") and "Load" (value "load"). Default "price".
2. zone switcher — a Select populated from the zones present in the data
   (collect distinct `zone` values from the fetched rows), plus an "All
   zones" option (value null = no zone filter). Default "All zones".

Row 1: FOUR KPI CARDS for the currently selected model_kind and zone:
- "MAE (30d)" — the `mae` value, unit EUR/MWh for price or MW for load,
  formatted to 2 decimals. Subtitle: "avg absolute error vs P50".
- "sMAPE" — the `smape` value formatted with 1 decimal and a "%" suffix.
  Subtitle: "symmetric mean absolute % error".
- "Bias" — the `bias` value with sign, 2 decimals, same unit as MAE.
  Color it amber when its absolute value is larger than the MAE, else
  default. Subtitle: "systematic over/under-forecast".
- "P10–P90 coverage" — the `coverage_p10_p90` value formatted with 1
  decimal and "%". Show a small green hint "band is honest" when it is
  between 70 and 95, otherwise a neutral hint. Subtitle: "share of actuals
  inside the predicted band".
If the summary row for the selection is missing (no scored data yet), show
each card with "—" and an info banner: "No scored forecasts yet — accuracy
appears here from the day after the first forecasts are issued."

Row 2: a line chart "P50 forecast vs actual — last 14 days":
- x axis: `target_time` formatted as "dd.MM HH:mm".
- A shaded band between `p10` and `p90` (recharts Area with a pair of
  stacked areas or a custom shape; fill at ~15% opacity).
- Line "P50 forecast" (`p50`) and line "Actual" (`actual`) in two
  contrasting colors, dots off.
- Tooltip showing all four values with the right unit (EUR/MWh or MW).
- Skip rows where any of p10/p50/p90/actual is null.

Row 3: a small table "Daily MAE — last 14 days" from the `daily` array of
the edge-function response: columns Date, Model, MAE, # scored points.

DATA SOURCE 1 — the forecast-accuracy edge function (KPIs + daily table)
------------------------------------------------------------------------
POST to:  <SUPABASE_URL>/functions/v1/forecast-accuracy
Headers:
  Authorization: Bearer <the current user's session access_token from
                  supabase.auth.getSession()>
  Content-Type: application/json

Request body (both fields optional; send the ones matching the switchers):
{
  "model_kind": "price" | "load",   // optional
  "zone": "HU"                       // optional, any string
}

Success response (HTTP 200):
{
  "ok": true,
  "summary": [
    {
      "organization_id": "uuid",
      "model_kind": "price" | "load",
      "zone": "HU",
      "n": 612,                          // scored points in the last 30 days
      "mae": 8.42,                       // vs P50, EUR/MWh or MW
      "rmse": 12.10,
      "smape": 9.7,                      // percent
      "bias": -1.23,                     // signed, EUR/MWh or MW
      "coverage_p10_p90": 81.4,          // percent
      "last_scored_at": "2026-09-02T13:45:01.123Z"
    }
  ],
  "daily": [
    { "date": "2026-08-28", "model_kind": "price", "mae": 7.9, "n": 24 }
  ]
}
`summary` contains one row per (model_kind, zone) combination that has
scored data; apply the switchers by filtering client-side OR by sending
them in the body (the function filters server-side — prefer sending them
and still keep the client robust to extra rows).
Error responses: 401 { "ok": false, "error": "..." } when the session is
missing/expired (redirect to login), 500 { "ok": false, "error": "..." }
on server failure (show a toast with the error message).

DATA SOURCE 2 — the hourly chart series (Supabase table directly)
-----------------------------------------------------------------
Use the existing Supabase client (RLS already limits rows to the user's
organisation — do NOT filter by organization_id yourself):

  supabase
    .from("forecast_predictions")
    .select("target_time, zone, model_kind, p10, p50, p90, actual")
    .eq("model_kind", <selected model_kind>)
    .not("actual", "is", null)
    .gte("target_time", <ISO timestamp 14 days ago>)
    .order("target_time", { ascending: true })
    // when a specific zone is selected: .eq("zone", <zone>)

If more than 1000 rows could match, page with .range() in 1000-row steps.
Rows with actual = null are forecasts not scored yet — exclude them from
the chart.

BEHAVIOR
--------
- Fetch both data sources on mount and whenever a switcher changes; show a
  loading skeleton while fetching.
- Refetch silently every 5 minutes.
- Handle 401 by redirecting to the login page; other errors show a toast
  and keep the last good data on screen.
- Everything on this page is read-only; no mutations.
```
