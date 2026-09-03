"""
VoltTrade Self-Improvement Loop (SPEC-selfimprove §2)

Closes the loop between production accuracy and retraining:
  - live_accuracy:    MAE of issued forecasts vs realized actuals, read from
                      `forecast_predictions` (scored rows only), over the
                      last `days` of target_time.
  - check_live_drift: per model_kind, recent 7d live MAE vs trailing 30d
                      live MAE — drift when recent is >10% worse.
  - maybe_rollback:   on confirmed live drift, restore the champion's
                      previous_champion_id row (flip is_active, mark the
                      restored row promotion_reason='rollback').

PostgREST access pattern copied from retrain/pipeline.py /
tracking/predictions.py: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars,
`requests`, paginated reads. NOTHING in this module raises — every public
function degrades to a neutral value on missing config or any failure.
"""

import logging
import os
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

PREDICTIONS_TABLE = "forecast_predictions"
MODELS_TABLE = "forecast_models"
PAGE_SIZE = 1000  # Supabase selects paginate at 1000 rows

MODEL_KINDS = ("price", "load")
DRIFT_RECENT_DAYS = 7
DRIFT_TRAILING_DAYS = 30
DRIFT_THRESHOLD = 0.10          # recent MAE > 10% worse than trailing => drift
MIN_LIVE_ROWS = 24              # both windows need >= 24 scored rows

# kind -> forecast_models.model_type filter for the active-champion lookup.
# pipeline._load_champion registers price champions as model_type='lightgbm'
# (older ones 'ensemble'*, hence the prefix match) and load champions as
# 'lightgbm_load' (pipeline.LOAD_MODEL_TYPE). NOTE: _load_champion's price
# path itself applies no model_type filter (legacy behavior); we filter
# explicitly here so the price rollback can never touch a load champion row.
_MODEL_TYPE_PARAMS = {
    "price": {"or": "(model_type.eq.lightgbm,model_type.like.ensemble*)"},
    "load": {"model_type": "eq.lightgbm_load"},
}


# ── Phase-4 alert hook (SPEC-phase4 §3) ──────────────────────────────────

def _safe_alert(org_id: Optional[str], **kwargs) -> None:
    """Emit an alerts-table event. Fully fire-and-forget: any failure is
    logged and swallowed so alerting can never affect drift/rollback."""
    try:
        if not org_id:
            return
        from alerts import emit_alert
        emit_alert(org_id, **kwargs)
    except Exception as e:
        logger.warning(f"alert hook failed (non-fatal): {e}")


# ── Supabase access (same PostgREST/`requests` pattern as pipeline.py) ────

def _sb_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _sb_headers() -> Dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _sb_get(table: str, params: Dict[str, str]) -> Optional[List[dict]]:
    """GET rows from a Supabase table. Returns None on any failure."""
    if not _sb_configured():
        return None
    try:
        resp = requests.get(f"{SUPABASE_URL}/rest/v1/{table}",
                            headers=_sb_headers(), params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"Supabase read from {table} failed: {e}")
        return None


def _sb_update(table: str, params: Dict[str, str], body: dict) -> bool:
    """PATCH rows in a Supabase table. Returns False on any failure."""
    if not _sb_configured():
        return False
    try:
        resp = requests.patch(f"{SUPABASE_URL}/rest/v1/{table}",
                              headers=_sb_headers(), params=params, json=body, timeout=30)
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.warning(f"Supabase update on {table} failed: {e}")
        return False


# ── 1. Live production accuracy ───────────────────────────────────────────

def live_accuracy(org_id: Optional[str], model_kind: str, days: int) -> Optional[dict]:
    """MAE of |p50 - actual| over scored forecast_predictions, last `days`.

    Reads only scored rows (actual NOT NULL) for the given model_kind with
    target_time within the last `days` days, org-filtered when org_id is
    given, paginating at 1000 rows.

    Returns {"mae": float, "n": int} — or None when n == 0 (no scored rows)
    or on any failure. NEVER raises.
    """
    try:
        if not _sb_configured():
            return None
        since = datetime.now(timezone.utc) - timedelta(days=days)

        abs_err = 0.0
        n = 0
        offset = 0
        while True:
            params: Dict[str, str] = {
                "select": "p50,actual",
                "actual": "not.is.null",
                "model_kind": f"eq.{model_kind}",
                "target_time": f"gte.{since.isoformat()}",
                "order": "target_time.asc",
                "offset": str(offset),
                "limit": str(PAGE_SIZE),
            }
            if org_id:
                params["organization_id"] = f"eq.{org_id}"

            page = _sb_get(PREDICTIONS_TABLE, params)
            if page is None:
                return None
            if not page:
                break
            for row in page:
                p50, actual = row.get("p50"), row.get("actual")
                if p50 is None or actual is None:
                    continue
                abs_err += abs(float(p50) - float(actual))
                n += 1
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE

        if n == 0:
            return None
        return {"mae": abs_err / n, "n": n}
    except Exception as e:
        logger.warning(f"live_accuracy failed (non-fatal): {e}")
        return None


# ── 2. Live drift detection ───────────────────────────────────────────────

def _kind_live_drift(org_id: Optional[str], model_kind: str) -> dict:
    """Drift verdict for one model_kind. NEVER raises.

    drift = recent 7d live MAE > trailing 30d live MAE * (1 + 10%), evaluated
    only when both windows hold >= 24 scored rows; otherwise drift=False with
    reason='insufficient_live_data'.
    """
    neutral = {"recent_mae": None, "trailing_mae": None, "n_recent": 0,
               "drift": False, "reason": "insufficient_live_data"}
    try:
        recent = live_accuracy(org_id, model_kind, DRIFT_RECENT_DAYS)
        trailing = live_accuracy(org_id, model_kind, DRIFT_TRAILING_DAYS)

        result = {
            "recent_mae": recent["mae"] if recent else None,
            "trailing_mae": trailing["mae"] if trailing else None,
            "n_recent": recent["n"] if recent else 0,
            "drift": False,
            "reason": "insufficient_live_data",
        }
        if (not recent or not trailing
                or recent.get("n", 0) < MIN_LIVE_ROWS
                or trailing.get("n", 0) < MIN_LIVE_ROWS):
            return result

        result["drift"] = bool(recent["mae"] > trailing["mae"] * (1 + DRIFT_THRESHOLD))
        result["reason"] = "drift_detected" if result["drift"] else "no_drift"
        return result
    except Exception as e:
        logger.warning(f"_kind_live_drift[{model_kind}] failed (non-fatal): {e}")
        return dict(neutral)


def check_live_drift(org_id: Optional[str]) -> dict:
    """Live drift verdict per model_kind. NEVER raises.

    Returns {model_kind: {"recent_mae", "trailing_mae", "n_recent",
    "drift", "reason"}} for model_kind in ('price', 'load'); kinds with
    insufficient live data get drift=False, reason='insufficient_live_data'.

    Phase-4 alert hook: every kind with confirmed drift emits a
    kind='drift' / severity='warning' alert (never affects the verdict).
    """
    try:
        verdicts = {kind: _kind_live_drift(org_id, kind) for kind in MODEL_KINDS}
        for kind, info in verdicts.items():
            if info.get("drift"):
                _safe_alert(org_id, kind="drift", severity="warning",
                            title=f"Live drift detected ({kind})",
                            body=(f"recent 7d MAE {info.get('recent_mae')} vs "
                                  f"trailing 30d MAE {info.get('trailing_mae')}"),
                            data={"model_kind": kind, **info})
        return verdicts
    except Exception as e:
        logger.warning(f"check_live_drift failed (non-fatal): {e}")
        return {kind: {"recent_mae": None, "trailing_mae": None, "n_recent": 0,
                       "drift": False, "reason": "insufficient_live_data"}
                for kind in MODEL_KINDS}


# ── 3. Auto-rollback to the previous champion ─────────────────────────────

def _load_active_model_row(org_id: str, model_kind: str) -> Optional[dict]:
    """Active forecast_models row for (org, kind) — same lookup convention
    as pipeline._load_champion, restricted to the kind's model_type family."""
    params: Dict[str, str] = {
        "organization_id": f"eq.{org_id}",
        "is_active": "eq.true",
        "order": "last_trained_at.desc",
        "limit": "1",
    }
    params.update(_MODEL_TYPE_PARAMS.get(model_kind, {}))
    rows = _sb_get(MODELS_TABLE, params)
    return rows[0] if rows else None


def maybe_rollback(org_id: Optional[str], model_kind: str) -> dict:
    """Roll back to the previous champion when live drift is confirmed.

      - no live drift for that kind -> {"rolled_back": False, "reason": "no_drift"}
      - drift AND champion.previous_champion_id set AND the previous row
        still exists -> reactivate previous (is_active=true,
        promotion_reason='rollback'), retire current (is_active=false),
        log via logger.warning
        -> {"rolled_back": True, "restored_model_id": <previous row id>}
      - otherwise -> {"rolled_back": False, "reason": "no_previous_champion"}

    NEVER raises.
    """
    def _no(reason: str) -> dict:
        return {"rolled_back": False, "reason": reason}

    try:
        if not _sb_configured():
            return _no("supabase_not_configured")
        if not org_id:
            return _no("no_org_id")

        # Rollback is drift-driven: no confirmed live drift -> no-op.
        drift = _kind_live_drift(org_id, model_kind)
        if not drift.get("drift"):
            return _no("no_drift")

        champion = _load_active_model_row(org_id, model_kind)
        if not champion:
            return _no("no_active_champion")

        prev_id = champion.get("previous_champion_id")
        if not prev_id:
            return _no("no_previous_champion")
        prev_rows = _sb_get(MODELS_TABLE, {"id": f"eq.{prev_id}", "limit": "1"})
        if not prev_rows:
            return _no("no_previous_champion")

        ok_old = _sb_update(MODELS_TABLE, {"id": f"eq.{prev_id}"},
                            {"is_active": True, "promotion_reason": "rollback"})
        ok_cur = _sb_update(MODELS_TABLE, {"id": f"eq.{champion['id']}"},
                            {"is_active": False})
        if not (ok_old and ok_cur):
            return _no("rollback_write_failed")

        logger.warning(
            f"auto-rollback[{model_kind}]: live drift "
            f"(recent 7d MAE {drift.get('recent_mae')} vs trailing 30d "
            f"{drift.get('trailing_mae')}) — restored previous champion "
            f"{prev_id}, retired {champion.get('id')}")
        _safe_alert(org_id, kind="rollback", severity="critical",
                    title=f"Auto-rollback executed ({model_kind})",
                    body=(f"Live drift confirmed — restored previous champion "
                          f"{prev_id}, retired {champion.get('id')}"),
                    data={"model_kind": model_kind,
                          "restored_model_id": prev_id,
                          "retired_model_id": champion.get("id"),
                          "recent_mae": drift.get("recent_mae"),
                          "trailing_mae": drift.get("trailing_mae")})
        return {"rolled_back": True, "restored_model_id": prev_id}
    except Exception as e:
        logger.warning(f"maybe_rollback failed (non-fatal): {e}")
        return _no(f"error: {e}")
