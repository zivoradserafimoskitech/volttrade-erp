"""
VoltTrade BESS Day-Ahead MPC (Phase 4, SPEC-phase4 §5)

Builds the optimal charge/discharge schedule for the next delivery day:
  1. Pull the latest P50 price forecast from `forecast_predictions`
     (model_kind='price', zone='MK', latest created_at per target_time,
     24 hourly points).
  2. Fallback when no usable forecast exists: same-day-last-week actuals
     from `market_price_history` (product='day_ahead', zone='MK').
  3. Optimize with the existing BessDispatch LP (optimize/bess_dispatch.py)
     — signature: optimize(prices, p_max_mw, e_max_mwh, ...) returning
     charge_schedule / discharge_schedule / soc_schedule_pct /
     revenue_eur / cycles_used.
  4. Persist into bess_dispatch_schedules.

Persistence adaptation (documented per SPEC §5 "map fields honestly"):
the real bess_dispatch_schedules schema (migration 20260901090000) is one
ROW PER HOUR — (organization_id, asset_id NULL, delivery_date,
hour_of_day, charge_mw, discharge_mw, soc_pct, price_forecast_eur_mwh,
revenue_eur) — not a single summary row. Because asset_id is NULL and the
UNIQUE key includes it, PostgREST merge-duplicates upserts CANNOT dedupe
(NULL never conflicts), so persistence is delete-then-insert for
(org, delivery_date, asset_id IS NULL): idempotent without touching rows
that belong to a specific registered asset.

`optimize_bess_day` NEVER raises.
"""

import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

from optimize.bess_dispatch import BessDispatch

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

PREDICTIONS_TABLE = "forecast_predictions"
PRICE_TABLE = "market_price_history"
SCHEDULE_TABLE = "bess_dispatch_schedules"
ZONE = "MK"
HOURS_PER_DAY = 24


def _sb_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _sb_headers(prefer: str = "return=representation") -> Dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def default_delivery_date(now: Optional[datetime] = None) -> date:
    """MPC target: tomorrow's delivery day."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return (now + timedelta(days=1)).date()


# ── Price series loading ──────────────────────────────────────────────────

def _load_p50_forecast(org_id: str, target: date) -> Optional[List[Tuple[int, float]]]:
    """Latest-created p50 per target hour for `target`. Returns a sorted
    list of (hour_utc, price) or None on failure/empty."""
    if not _sb_configured():
        return None
    try:
        start = datetime(target.year, target.month, target.day, tzinfo=timezone.utc)
        end = start + timedelta(days=1)
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{PREDICTIONS_TABLE}",
            headers=_sb_headers(),
            params={
                "select": "target_time,p50,created_at",
                "organization_id": f"eq.{org_id}",
                "model_kind": "eq.price",
                "zone": f"eq.{ZONE}",
                "target_time": f"gte.{start.isoformat()}",
                "and": f"(target_time.lt.{end.isoformat()})",
                "order": "created_at.desc",
                "limit": "1000",
            },
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json() or []
        latest: Dict[int, float] = {}
        for r in rows:  # created_at desc => first row per hour wins
            ts, p50 = r.get("target_time"), r.get("p50")
            if ts is None or p50 is None:
                continue
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.hour not in latest:
                latest[dt.hour] = float(p50)
        if not latest:
            return None
        return sorted(latest.items())
    except Exception as e:
        logger.warning(f"p50 forecast load failed: {e}")
        return None


def _load_fallback_actuals(org_id: str, target: date) -> Optional[List[Tuple[int, float]]]:
    """Same-day-last-week day-ahead actuals for `target` (zone MK).
    Returns sorted (hour_utc, price) or None."""
    if not _sb_configured():
        return None
    try:
        ref = target - timedelta(days=7)
        start = datetime(ref.year, ref.month, ref.day, tzinfo=timezone.utc)
        end = start + timedelta(days=1)
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{PRICE_TABLE}",
            headers=_sb_headers(),
            params={
                "select": "timestamp,price_eur_mwh",
                "organization_id": f"eq.{org_id}",
                "product": "eq.day_ahead",
                "zone": f"eq.{ZONE}",
                "timestamp": f"gte.{start.isoformat()}",
                "and": f"(timestamp.lt.{end.isoformat()})",
                "order": "timestamp.asc",
                "limit": "1000",
            },
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json() or []
        out: Dict[int, float] = {}
        for r in rows:
            ts, price = r.get("timestamp"), r.get("price_eur_mwh")
            if ts is None or price is None:
                continue
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            out[dt.hour] = float(price)
        if not out:
            return None
        return sorted(out.items())
    except Exception as e:
        logger.warning(f"fallback actuals load failed: {e}")
        return None


# ── Persistence ───────────────────────────────────────────────────────────

def _persist_schedule(org_id: str, target: date,
                      points: List[Tuple[int, float]],
                      dispatch: Dict[str, Any]) -> int:
    """Replace this org's asset-less schedule for `target` with the new
    dispatch rows. Delete-then-insert (see module docstring: merge-upsert
    cannot dedupe on the NULL asset_id in the UNIQUE key). Returns rows
    written, 0 on failure. Never raises."""
    try:
        charge = dispatch.get("charge_schedule") or []
        discharge = dispatch.get("discharge_schedule") or []
        soc = dispatch.get("soc_schedule_pct") or []
        n = min(len(points), len(charge), len(discharge), len(soc))
        if n == 0:
            return 0
        rows = [{
            "organization_id": org_id,
            "asset_id": None,
            "delivery_date": target.isoformat(),
            "hour_of_day": int(hour),
            "charge_mw": float(charge[i]),
            "discharge_mw": float(discharge[i]),
            "soc_pct": float(soc[i]),
            "price_forecast_eur_mwh": float(price),
            "revenue_eur": round((float(discharge[i]) - float(charge[i])) * float(price), 4),
        } for i, (hour, price) in enumerate(points[:n])]

        # Clear previous asset-less schedule for this delivery day first.
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/{SCHEDULE_TABLE}",
            headers=_sb_headers(prefer="return=minimal"),
            params={
                "organization_id": f"eq.{org_id}",
                "delivery_date": f"eq.{target.isoformat()}",
                "asset_id": "is.null",
            },
            timeout=30,
        ).raise_for_status()

        requests.post(
            f"{SUPABASE_URL}/rest/v1/{SCHEDULE_TABLE}",
            headers=_sb_headers(prefer="return=minimal"),
            json=rows,
            timeout=30,
        ).raise_for_status()
        return len(rows)
    except Exception as e:
        logger.warning(f"bess schedule persist failed (non-fatal): {e}")
        return 0


# ── Entry point ───────────────────────────────────────────────────────────

def optimize_bess_day(org_id: str, target_date: Optional[date] = None,
                      p_max_mw: float = 1.0, e_max_mwh: float = 2.0) -> Dict[str, Any]:
    """Optimize tomorrow's (or target_date's) BESS dispatch. NEVER raises.

    Returns:
      {"date": str, "expected_revenue_eur": float | None,
       "cycles": float | None, "hours": int,
       "schedule_source": "forecast" | "fallback_actuals" | "none",
       "persisted": int, "solver_status": str | None}
      With an "error" key when the run degraded.
    """
    result: Dict[str, Any] = {
        "date": None, "expected_revenue_eur": None, "cycles": None,
        "hours": 0, "schedule_source": "none", "persisted": 0,
        "solver_status": None,
    }
    try:
        target = target_date or default_delivery_date()
        if isinstance(target, datetime):
            target = target.date()
        result["date"] = target.isoformat()
        if not org_id:
            result["error"] = "no_org_id"
            return result
        if p_max_mw <= 0 or e_max_mwh <= 0:
            result["error"] = "p_max_mw and e_max_mwh must be positive"
            return result

        points = _load_p50_forecast(org_id, target)
        source = "forecast"
        if not points or len(points) < HOURS_PER_DAY:
            if points:
                logger.info(f"only {len(points)} forecast hours for {target} — fallback")
            points = _load_fallback_actuals(org_id, target)
            source = "fallback_actuals"
        if not points:
            result["error"] = ("no price forecast and no same-day-last-week "
                               "actuals available")
            return result
        result["schedule_source"] = source
        result["hours"] = len(points)

        prices = [p for _, p in points]
        dispatch = BessDispatch().optimize(prices, p_max_mw=p_max_mw,
                                           e_max_mwh=e_max_mwh)
        result["expected_revenue_eur"] = dispatch.get("revenue_eur")
        result["cycles"] = dispatch.get("cycles_used")
        result["solver_status"] = dispatch.get("solver_status")

        if _sb_configured():
            result["persisted"] = _persist_schedule(org_id, target, points, dispatch)

        logger.info(f"optimize_bess_day[{org_id}] {target}: source={source}, "
                    f"revenue={result['expected_revenue_eur']}, "
                    f"cycles={result['cycles']}, persisted={result['persisted']}")
        return result
    except Exception as e:
        logger.warning(f"optimize_bess_day failed (non-fatal): {e}")
        result["error"] = str(e)
        return result
