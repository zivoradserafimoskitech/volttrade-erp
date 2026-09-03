"""
VoltTrade Forecast Accuracy Tracking (python-service side).

Logs issued point forecasts (p10/p50/p90) into Supabase
`forecast_predictions` via PostgREST and later fills in `actual` for
mature rows (price from `market_price_history`, load from
`load_history`). The rolling 30-day aggregates live in the SQL view
`v_forecast_accuracy`; `accuracy_metrics` mirrors its math in pure
Python for unit-testability.

PostgREST access pattern copied from retrain/pipeline.py:
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars, `requests`.

Everything degrades gracefully — NONE of the public functions raise;
missing Supabase config or any network/HTTP failure is logged and
turned into a neutral return value.
"""

import logging
import os
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

# The database is reached through the VoltTrade `analytics-db` edge proxy, not
# PostgREST directly: the real service-role key never leaves the backend. Prefer
# the unambiguous VOLTTRADE_DB_PROXY_* names; SUPABASE_* are legacy fallbacks
# whose values on this host are the proxy URL and the analytics key, NOT a real
# Supabase service-role key.
SUPABASE_URL = (
    os.getenv("VOLTTRADE_DB_PROXY_URL") or os.getenv("SUPABASE_URL", "")
).rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("VOLTTRADE_DB_PROXY_KEY") or os.getenv(
    "SUPABASE_SERVICE_ROLE_KEY", ""
)

TABLE = "forecast_predictions"
PAGE_SIZE = 1000  # Supabase selects paginated (1000-row cap)
# A row becomes scoreable 2h after its target hour, leaving time for
# the actuals (day-ahead prices / A65 load) to land in Supabase.
MATURITY_LAG = timedelta(hours=2)


# ── Supabase access (same PostgREST/`requests` pattern as retrain/pipeline) ──

def _sb_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _sb_headers(prefer: str = "return=representation") -> Dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


# ── 1. Logging issued forecasts ────────────────────────────────────────────

def log_predictions(org_id: str, zone: str, model_kind: str,
                    points: List[dict], model_version: Optional[str] = None) -> int:
    """Batch-insert issued point forecasts into `forecast_predictions`.

    `points`: list of {target_time (ISO str), horizon_hours (int),
    p10, p50, p90}. Duplicate re-issues (same org/target/zone/kind/
    created_at second) are merged via Prefer: resolution=merge-duplicates.

    NEVER raises — on any failure logs a warning and returns 0.
    Returns the number of rows inserted on success.
    """
    try:
        if not _sb_configured():
            logger.warning("log_predictions: Supabase not configured — skipping")
            return 0
        if not org_id or not points:
            return 0
        if model_kind not in ("price", "load"):
            logger.warning(f"log_predictions: unknown model_kind {model_kind!r} — skipping")
            return 0

        now_iso = datetime.now(timezone.utc).isoformat()
        rows: List[Dict[str, Any]] = []
        for p in points:
            target_time = p.get("target_time")
            if not target_time:
                continue
            if hasattr(target_time, "isoformat"):
                target_time = target_time.isoformat()
            rows.append({
                "organization_id": org_id,
                "created_at": now_iso,
                "target_time": str(target_time),
                "zone": zone,
                "model_kind": model_kind,
                "model_version": model_version,
                "horizon_hours": int(p.get("horizon_hours") or 0),
                "p10": p.get("p10"),
                "p50": p.get("p50"),
                "p90": p.get("p90"),
            })
        if not rows:
            return 0

        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/{TABLE}",
            headers=_sb_headers(prefer="return=minimal,resolution=merge-duplicates"),
            json=rows,
            timeout=30,
        )
        resp.raise_for_status()
        logger.info(f"log_predictions: inserted {len(rows)} {model_kind} forecasts "
                    f"for org={org_id} zone={zone}")
        return len(rows)
    except Exception as e:
        logger.warning(f"log_predictions failed (non-fatal): {e}")
        return 0


# ── 2. Scoring mature predictions ──────────────────────────────────────────

def _fetch_actual(row: dict) -> Optional[float]:
    """Look up the realized value for one prediction row. None if absent."""
    table = "market_price_history" if row["model_kind"] == "price" else "load_history"
    value_col = "price_eur_mwh" if row["model_kind"] == "price" else "load_mw"
    params = {
        "select": value_col,
        "organization_id": f"eq.{row['organization_id']}",
        "timestamp": f"eq.{row['target_time']}",
        "zone": f"eq.{row['zone']}",
        "limit": "1",
    }
    if row["model_kind"] == "price":
        params["product"] = "eq.day_ahead"
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_sb_headers(),
        params=params,
        timeout=30,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        return None
    val = rows[0].get(value_col)
    return float(val) if val is not None else None


def score_mature_predictions(now: Optional[datetime] = None) -> dict:
    """Score all mature, unscored predictions. NEVER raises.

    Mature = `actual IS NULL AND target_time <= now - 2 hours`.
    Pages through candidates (1000/page), looks up the actual per row,
    and PATCHes `actual`/`scored_at` by id.

    Returns {"candidates": int, "scored": int, "missing_actuals": int},
    or {"candidates": 0, "scored": 0, "missing_actuals": 0, "error": str(e)}
    on infrastructure failure.
    """
    try:
        if not _sb_configured():
            return {"candidates": 0, "scored": 0, "missing_actuals": 0,
                    "error": "supabase not configured"}

        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        cutoff = (now - MATURITY_LAG).isoformat()
        scored_at = now.isoformat()

        candidates = 0
        scored = 0
        missing = 0
        offset = 0
        while True:
            resp = requests.get(
                f"{SUPABASE_URL}/rest/v1/{TABLE}",
                headers=_sb_headers(),
                params={
                    "select": "id,organization_id,target_time,zone,model_kind",
                    "actual": "is.null",
                    "target_time": f"lte.{cutoff}",
                    "order": "target_time.asc",
                    "offset": str(offset),
                    "limit": str(PAGE_SIZE),
                },
                timeout=30,
            )
            resp.raise_for_status()
            page = resp.json()
            if not page:
                break
            candidates += len(page)

            for row in page:
                actual = _fetch_actual(row)
                if actual is None:
                    missing += 1
                    continue
                patch = requests.patch(
                    f"{SUPABASE_URL}/rest/v1/{TABLE}",
                    headers=_sb_headers(prefer="return=minimal"),
                    params={"id": f"eq.{row['id']}"},
                    json={"actual": actual, "scored_at": scored_at},
                    timeout=30,
                )
                patch.raise_for_status()
                scored += 1

            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE

        result = {"candidates": candidates, "scored": scored,
                  "missing_actuals": missing}
        logger.info(f"score_mature_predictions: {result}")
        return result
    except Exception as e:
        logger.warning(f"score_mature_predictions failed: {e}")
        return {"candidates": 0, "scored": 0, "missing_actuals": 0,
                "error": str(e)}


# ── 3. Pure accuracy metrics (mirrors v_forecast_accuracy math) ─────────────

def accuracy_metrics(errors: List[float], actuals: List[float],
                     p50: List[float], in_band: List[bool]) -> dict:
    """Accuracy metrics from parallel per-row vectors. Pure, never raises.

    errors[i]  = actuals[i] - p50[i]
    in_band[i] = whether actuals[i] fell inside [p10, p90] (rows without
                 p10/p90 should simply be omitted from in_band)

    Mirrors the SQL in v_forecast_accuracy:
      mae     = avg(|e|)
      rmse    = sqrt(avg(e^2))
      bias    = avg(e)
      smape   = avg over non-zero-denominator rows of
                2|e|/(|actual|+|p50|) * 100   (percent)
      coverage = share of in_band rows that are True * 100 (percent)
    """
    errs = [float(e) for e in (errors or [])]
    n = len(errs)
    mae = rmse = bias = None
    if n:
        mae = sum(abs(e) for e in errs) / n
        rmse = math.sqrt(sum(e * e for e in errs) / n)
        bias = sum(errs) / n

    smape_terms = []
    for a, f in zip(actuals or [], p50 or []):
        denom = abs(a) + abs(f)
        if denom > 0:
            smape_terms.append(2.0 * abs(a - f) / denom * 100.0)
    smape = (sum(smape_terms) / len(smape_terms)) if smape_terms else None

    band = [bool(b) for b in (in_band or [])]
    coverage = (sum(band) / len(band) * 100.0) if band else None

    return {
        "n": n,
        "mae": mae,
        "rmse": rmse,
        "smape": smape,
        "bias": bias,
        "coverage_p10_p90": coverage,
    }
