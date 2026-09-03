"""
VoltTrade Portfolio CVaR (Phase 4, SPEC-phase4 §6)

Marks the current open position to Monte-Carlo price scenarios sampled
from the champion's quantile band and reports VaR95 / CVaR95.

Open position (adaptation, documented per SPEC §6): the real `trades`
schema (migration 20260420182507 + org-tenancy migration 20260812120000)
has organization_id, volume_mwh, side (text, 'buy'/'sell'), delivery_start
/ delivery_end and status — there is no dedicated "open" flag, so the
open position is defined as the signed sum of volume_mwh (buy=+, sell=-)
over non-cancelled trades delivering inside the horizon
[now, now + days]. `volume_mwh * side` per SPEC, with side mapped to a
sign of ±1.

Scenarios: the latest 24*days hourly rows of `forecast_predictions`
(model_kind='price', p10/p50/p90, target_time >= now, zone MK); each hour
approximated as Normal(mu=p50, sigma=(p90-p10)/2.563) — 2.563 = 2*z80, so
an exact normal P10..P90 band. Monte Carlo n=2000 paths; per-path P&L of
the open position vs the p50 path; VaR/CVaR computed with the same
percentile + tail-mean math as HedgeOptimizer.optimize (costs >= VaR95
threshold convention).

`portfolio_cvar` NEVER raises; insufficient data returns
basis='insufficient_data' with whatever partial info exists.
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import numpy as np
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
TRADES_TABLE = "trades"
ZONE = "MK"
N_SCENARIOS = 2000
BETA = 0.95
# sigma = (p90 - p10) / (2 * z_0.80); z_0.80 = 1.2815516 -> 2.5631...
P10_P90_TO_SIGMA = 1.0 / 2.5631031

_BUY_SIDES = {"buy", "b", "long", "purchase"}
_SELL_SIDES = {"sell", "s", "short", "sale"}


def _sb_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _sb_headers() -> Dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _side_sign(side: Any) -> Optional[float]:
    s = str(side or "").strip().lower()
    if s in _BUY_SIDES:
        return 1.0
    if s in _SELL_SIDES:
        return -1.0
    return None


def _open_position_mwh(org_id: str, days: int, now: datetime) -> Dict[str, Any]:
    """Signed open volume over trades delivering in [now, now+days].
    Returns {"open_volume_mwh": float, "n_trades": int,
    "skipped_trades": int}. Empty/zero dict values on failure (never raises)."""
    out = {"open_volume_mwh": 0.0, "n_trades": 0, "skipped_trades": 0}
    if not _sb_configured() or not org_id:
        return out
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{TRADES_TABLE}",
            headers=_sb_headers(),
            params={
                "select": "volume_mwh,side,status",
                "organization_id": f"eq.{org_id}",
                "delivery_start": f"gte.{now.isoformat()}",
                "and": f"(delivery_start.lt.{(now + timedelta(days=days)).isoformat()})",
                "limit": "10000",
            },
            timeout=30,
        )
        resp.raise_for_status()
        for row in resp.json() or []:
            if str(row.get("status") or "").lower() == "cancelled":
                continue
            sign = _side_sign(row.get("side"))
            vol = row.get("volume_mwh")
            if sign is None or vol is None:
                out["skipped_trades"] += 1
                continue
            out["open_volume_mwh"] += sign * float(vol)
            out["n_trades"] += 1
    except Exception as e:
        logger.warning(f"open position read failed (non-fatal): {e}")
    out["open_volume_mwh"] = round(out["open_volume_mwh"], 6)
    return out


def _load_quantile_band(org_id: str, days: int, now: datetime) -> Optional[Dict[str, np.ndarray]]:
    """Latest 24*days forecast quantile rows (model_kind='price', zone MK,
    target_time >= now). Newest issue per target_time wins. Returns
    {"p50","p10","p90"} hour-sorted arrays, or None when insufficient."""
    if not _sb_configured() or not org_id:
        return None
    try:
        limit = 24 * max(1, int(days))
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{PREDICTIONS_TABLE}",
            headers=_sb_headers(),
            params={
                "select": "target_time,p10,p50,p90,created_at",
                "organization_id": f"eq.{org_id}",
                "model_kind": "eq.price",
                "zone": f"eq.{ZONE}",
                "target_time": f"gte.{now.isoformat()}",
                "order": "created_at.desc",
                "limit": str(4 * limit),  # headroom for re-issued hours
            },
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json() or []
        latest: Dict[str, tuple] = {}
        for r in rows:  # created_at desc => first row per target_time wins
            ts = r.get("target_time")
            p10, p50, p90 = r.get("p10"), r.get("p50"), r.get("p90")
            if ts is None or p50 is None or p10 is None or p90 is None:
                continue
            key = str(ts)
            if key not in latest:
                latest[key] = (float(p10), float(p50), float(p90))
            if len(latest) >= limit:
                break
        if len(latest) < 24:
            return None
        ordered = sorted(latest.items())[:limit]
        return {
            "p10": np.array([v[0] for _, v in ordered]),
            "p50": np.array([v[1] for _, v in ordered]),
            "p90": np.array([v[2] for _, v in ordered]),
        }
    except Exception as e:
        logger.warning(f"quantile band read failed (non-fatal): {e}")
        return None


def cvar_from_scenarios(pnl: np.ndarray, beta: float = BETA) -> Dict[str, float]:
    """VaR/CVaR of LOSSES (-pnl) at confidence `beta`, using the same
    percentile + tail-mean convention as HedgeOptimizer.optimize:
    var = percentile(losses, beta*100); cvar = mean(losses >= var)."""
    losses = -np.asarray(pnl, dtype=float)
    var = float(np.percentile(losses, beta * 100))
    tail = losses[losses >= var]
    cvar = float(np.mean(tail)) if len(tail) else var
    return {"var": var, "cvar": cvar}


def portfolio_cvar(org_id: str, days: int = 30) -> Dict[str, Any]:
    """CVaR95 of the open position over champion-quantile scenarios.
    NEVER raises.

    Returns:
      {"open_volume_mwh": float, "cvar95_eur": float | None,
       "var95_eur": float | None, "scenarios": int,
       "basis": "forecast_quantiles" | "insufficient_data",
       "n_trades": int, "horizon_hours": int}
    """
    result: Dict[str, Any] = {
        "open_volume_mwh": 0.0, "cvar95_eur": None, "var95_eur": None,
        "scenarios": 0, "basis": "insufficient_data",
        "n_trades": 0, "horizon_hours": 0,
    }
    try:
        now = datetime.now(timezone.utc)
        days = max(1, int(days))

        position = _open_position_mwh(org_id, days, now)
        result["open_volume_mwh"] = position["open_volume_mwh"]
        result["n_trades"] = position["n_trades"]
        if position["skipped_trades"]:
            result["skipped_trades"] = position["skipped_trades"]

        band = _load_quantile_band(org_id, days, now)
        if band is None or abs(position["open_volume_mwh"]) < 1e-9:
            result["notes"] = ("no quantile band" if band is None else
                               "no open position in horizon")
            logger.info(f"portfolio_cvar[{org_id}]: insufficient_data "
                        f"({result['notes']})")
            return result

        p50, p10, p90 = band["p50"], band["p10"], band["p90"]
        sigma = np.maximum((p90 - p10) * P10_P90_TO_SIGMA, 1e-6)
        result["horizon_hours"] = int(len(p50))
        result["basis"] = "forecast_quantiles"
        result["scenarios"] = N_SCENARIOS

        rng = np.random.default_rng(42)
        # Per-path average price over the horizon; position P&L vs p50 path.
        paths = p50[None, :] + sigma[None, :] * rng.standard_normal(
            (N_SCENARIOS, len(p50)))
        pnl = position["open_volume_mwh"] * (paths.mean(axis=1) - p50.mean())

        risk = cvar_from_scenarios(pnl)
        result["var95_eur"] = round(risk["var"], 2)
        result["cvar95_eur"] = round(risk["cvar"], 2)

        logger.info(f"portfolio_cvar[{org_id}]: vol={result['open_volume_mwh']} MWh, "
                    f"VaR95={result['var95_eur']}, CVaR95={result['cvar95_eur']}")
        return result
    except Exception as e:
        logger.warning(f"portfolio_cvar failed (non-fatal): {e}")
        result["error"] = str(e)
        return result
