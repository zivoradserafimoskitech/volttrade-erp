"""
VoltTrade Alerts (Phase 4, SPEC-phase4 §2)

Single `emit_alert` entry point used by every subsystem (retrain pipeline,
self-improvement loop, arbitrage scanner) to record operational events in
the `alerts` table and, optionally, fan out to a webhook.

PostgREST access pattern copied from tracking/predictions.py and
retrain/pipeline.py: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars,
`requests`. `emit_alert` NEVER raises — any failure (missing config,
network error, HTTP error) is logged and reported via the False return
value, so an alerting outage can never break the flow being alerted on.

Schema (migration 20260902090200_phase4_alerts_arbitrage.sql, GLUE-owned):
  alerts(id, organization_id NOT NULL, created_at, kind, severity,
         title NOT NULL, body, data jsonb, read_at)
  kind     IN ('retrain_failure','drift','rollback','promotion',
               'arbitrage','system')
  severity IN ('info','warning','critical')  DEFAULT 'info'
"""

import logging
import os
import threading
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ALERT_WEBHOOK_URL = os.getenv("ALERT_WEBHOOK_URL", "")

TABLE = "alerts"
VALID_KINDS = ("retrain_failure", "drift", "rollback", "promotion",
               "arbitrage", "system")
VALID_SEVERITIES = ("info", "warning", "critical")


def _sb_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _sb_headers() -> Dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def _fire_webhook(text: str) -> None:
    """Fire-and-forget webhook POST (3s timeout). Runs in a daemon thread
    so the caller never blocks; NEVER raises."""
    def _post() -> None:
        try:
            requests.post(ALERT_WEBHOOK_URL, json={"text": text}, timeout=3)
        except Exception as e:
            logger.warning(f"alert webhook POST failed (non-fatal): {e}")

    try:
        threading.Thread(target=_post, name="alert-webhook", daemon=True).start()
    except Exception as e:
        logger.warning(f"alert webhook launch failed (non-fatal): {e}")


def emit_alert(org_id: str, kind: str, title: str, body: str = "",
               severity: str = "info", data: Optional[Dict[str, Any]] = None) -> bool:
    """Insert one row into `alerts` via PostgREST. NEVER raises.

    Returns True when the row was persisted. Returns False (and only logs)
    when org_id is missing (alerts.organization_id is NOT NULL), when
    Supabase is not configured, or on any network/HTTP failure. Unknown
    kind/severity values are coerced to 'system'/'info' rather than
    rejected — a mistyped alert is still more useful than a dropped one.

    When env ALERT_WEBHOOK_URL is set, additionally fires a webhook POST
    {"text": "[severity] title — body"} (fire-and-forget, 3s timeout).
    """
    try:
        if kind not in VALID_KINDS:
            logger.warning(f"emit_alert: unknown kind {kind!r} — coerced to 'system'")
            kind = "system"
        if severity not in VALID_SEVERITIES:
            logger.warning(f"emit_alert: unknown severity {severity!r} — coerced to 'info'")
            severity = "info"

        if ALERT_WEBHOOK_URL:
            text = f"[{severity}] {title}" + (f" — {body}" if body else "")
            _fire_webhook(text)

        if not org_id:
            logger.warning("emit_alert: no org_id — alert not persisted")
            return False
        if not _sb_configured():
            logger.warning("emit_alert: Supabase not configured — alert not persisted")
            return False

        row = {
            "organization_id": org_id,
            "kind": kind,
            "severity": severity,
            "title": str(title)[:500],
            "body": body or "",
            "data": data or {},
        }
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/{TABLE}",
            headers=_sb_headers(),
            json=row,
            timeout=10,
        )
        resp.raise_for_status()
        logger.info(f"alert emitted: kind={kind} severity={severity} title={title!r}")
        return True
    except Exception as e:
        logger.warning(f"emit_alert failed (non-fatal): {e}")
        return False
