"""
VoltTrade Cross-Border Arbitrage Scanner (Phase 4, SPEC-phase4 §4)

Scans day-ahead prices across the SEE zones (MK / HU / RS) held in
`market_price_history` and persists hourly cross-zone spreads above a
threshold into `arbitrage_opportunities`. Emits an `arbitrage` alert when
at least one opportunity is found.

PostgREST access pattern copied from tracking/predictions.py:
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars, `requests`, paginated
reads. `scan_arbitrage` NEVER raises — missing config, missing zones, or
any HTTP failure degrade to a partial/neutral result.

Schema (migration 20260902090200_phase4_alerts_arbitrage.sql, GLUE-owned):
  arbitrage_opportunities(organization_id, detected_at, target_date,
      buy_zone, sell_zone, hour 0-23, buy_price, sell_price,
      spread_eur_mwh)
  UNIQUE (organization_id, target_date, buy_zone, sell_zone, hour)
"""

import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

from alerts import emit_alert

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

PRICE_TABLE = "market_price_history"
ARB_TABLE = "arbitrage_opportunities"
ZONES = ("MK", "HU", "RS")
PAGE_SIZE = 1000
# Day-ahead results for tomorrow are normally all in by ~13:00 UTC;
# before that, scanning "today" is the useful default.
DA_PUBLISH_HOUR_UTC = 13


def _sb_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _sb_headers(prefer: str = "return=representation") -> Dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def default_target_date(now: Optional[datetime] = None) -> date:
    """Tomorrow once day-ahead results are published (>= 13:00 UTC),
    otherwise today."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    if now.hour >= DA_PUBLISH_HOUR_UTC:
        return (now + timedelta(days=1)).date()
    return now.date()


def _fetch_day_ahead_prices(org_id: str, target: date) -> Optional[List[dict]]:
    """All day-ahead rows for (org, target date, ZONES), paginated.
    Returns None on infrastructure failure, [] when simply empty."""
    if not _sb_configured():
        return None
    start = datetime(target.year, target.month, target.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    rows: List[dict] = []
    offset = 0
    while True:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{PRICE_TABLE}",
            headers=_sb_headers(),
            params={
                "select": "timestamp,zone,price_eur_mwh",
                "organization_id": f"eq.{org_id}",
                "product": "eq.day_ahead",
                "zone": f"in.({','.join(ZONES)})",
                "timestamp": f"gte.{start.isoformat()}",
                "and": f"(timestamp.lt.{end.isoformat()})",
                "order": "timestamp.asc",
                "offset": str(offset),
                "limit": str(PAGE_SIZE),
            },
            timeout=30,
        )
        resp.raise_for_status()
        page = resp.json()
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def _hourly_prices(rows: List[dict]) -> Dict[str, Dict[int, float]]:
    """zone -> hour(UTC) -> price. Duplicates collapse to the last row
    (rows arrive timestamp-asc; identical hour re-ingests overwrite)."""
    out: Dict[str, Dict[int, float]] = {}
    for r in rows:
        zone = r.get("zone")
        price = r.get("price_eur_mwh")
        ts = r.get("timestamp")
        if not zone or price is None or not ts:
            continue
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            out.setdefault(zone, {})[dt.hour] = float(price)
        except (TypeError, ValueError):
            continue
    return out


def _persist_opportunities(rows: List[dict]) -> int:
    """Upsert winners into arbitrage_opportunities (merge-duplicates on
    the natural UNIQUE key). Returns rows written, 0 on failure."""
    if not rows:
        return 0
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/{ARB_TABLE}",
        headers=_sb_headers(prefer="return=minimal,resolution=merge-duplicates"),
        json=rows,
        params={"on_conflict": "organization_id,target_date,buy_zone,sell_zone,hour"},
        timeout=30,
    )
    resp.raise_for_status()
    return len(rows)


def scan_arbitrage(org_id: str, target_date: Optional[date] = None,
                   threshold_eur_mwh: float = 10.0) -> Dict[str, Any]:
    """Scan one delivery date for cross-zone hourly spreads. NEVER raises.

    For every hour and every ORDERED zone pair (buy_zone, sell_zone) with
    day-ahead price data on both sides: spread = sell - buy; pairs with
    spread >= threshold_eur_mwh are upserted into arbitrage_opportunities
    and reported. Missing zones produce a partial scan (noted in result).

    Returns:
      {"date": str, "opportunities": int, "best_spread": float | None,
       "pairs": [{"buy_zone","sell_zone","hour","buy_price","sell_price",
                  "spread_eur_mwh"}, ...],
       "zones_scanned": [...], "missing_zones": [...],
       "persisted": int, "partial": bool}
      On infrastructure failure the same shape is returned with
      opportunities=0, persisted=0 and an "error" key.
    """
    result: Dict[str, Any] = {
        "date": None, "opportunities": 0, "best_spread": None,
        "pairs": [], "zones_scanned": [], "missing_zones": list(ZONES),
        "persisted": 0, "partial": False,
    }
    try:
        target = target_date or default_target_date()
        if isinstance(target, datetime):
            target = target.date()
        result["date"] = target.isoformat()
        if not org_id:
            result["error"] = "no_org_id"
            return result

        rows = _fetch_day_ahead_prices(org_id, target)
        if rows is None:
            result["error"] = "supabase not configured or read failed"
            return result

        hourly = _hourly_prices(rows)
        zones_present = [z for z in ZONES if hourly.get(z)]
        result["zones_scanned"] = zones_present
        result["missing_zones"] = [z for z in ZONES if z not in zones_present]
        result["partial"] = bool(result["missing_zones"])
        if not zones_present:
            result["error"] = "no day-ahead price data for any zone"
            return result

        winners: List[Dict[str, Any]] = []
        for buy_zone in zones_present:
            for sell_zone in zones_present:
                if sell_zone == buy_zone:
                    continue
                buy_hours = hourly[buy_zone]
                sell_hours = hourly[sell_zone]
                for hour in sorted(set(buy_hours) & set(sell_hours)):
                    spread = sell_hours[hour] - buy_hours[hour]
                    if spread >= threshold_eur_mwh:
                        winners.append({
                            "buy_zone": buy_zone,
                            "sell_zone": sell_zone,
                            "hour": hour,
                            "buy_price": round(buy_hours[hour], 4),
                            "sell_price": round(sell_hours[hour], 4),
                            "spread_eur_mwh": round(spread, 4),
                        })

        result["opportunities"] = len(winners)
        result["pairs"] = sorted(winners, key=lambda w: -w["spread_eur_mwh"])
        if winners:
            result["best_spread"] = result["pairs"][0]["spread_eur_mwh"]
            try:
                db_rows = [{
                    "organization_id": org_id,
                    "target_date": target.isoformat(),
                    **w,
                } for w in winners]
                result["persisted"] = _persist_opportunities(db_rows)
            except Exception as e:
                logger.warning(f"arbitrage persist failed (non-fatal): {e}")
                result["persist_error"] = str(e)

            best = result["pairs"][0]
            try:
                emit_alert(
                    org_id, kind="arbitrage", severity="info",
                    title=f"{len(winners)} arbitrage opportunity(ies) for {target.isoformat()}",
                    body=(f"Best spread {best['spread_eur_mwh']:.2f} EUR/MWh: "
                          f"buy {best['buy_zone']} / sell {best['sell_zone']} "
                          f"hour {best['hour']:02d}:00 UTC"),
                    data={"date": target.isoformat(),
                          "opportunities": len(winners),
                          "best": best},
                )
            except Exception as e:  # emit_alert never raises; belt & braces
                logger.warning(f"arbitrage alert failed (non-fatal): {e}")

        logger.info(f"scan_arbitrage[{org_id}] {target}: {result['opportunities']} "
                    f"opportunities, best={result['best_spread']}, "
                    f"partial={result['partial']}")
        return result
    except Exception as e:
        logger.warning(f"scan_arbitrage failed (non-fatal): {e}")
        result["error"] = str(e)
        return result
