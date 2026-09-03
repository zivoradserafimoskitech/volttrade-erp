"""Phase 4 tests (SPEC-phase4 §10).

Run from python-service/:  python3 -m pytest tests/test_phase4.py -v

Covers:
  - emit_alert: payload shape, never-raises on HTTP error, webhook skipped
    when ALERT_WEBHOOK_URL unset
  - scan_arbitrage: synthetic 2-zone frame -> correct spreads / threshold /
    persistence payload; missing zone -> partial scan
  - optimize_bess_day: forecast path vs same-day-last-week fallback;
    persisted rows match the real bess_dispatch_schedules columns
  - portfolio_cvar: quantile-band sigma math, insufficient_data path
  - endpoint smoke tests (TestClient) for /arbitrage/scan, /bess/optimize,
    /portfolio/cvar
"""

import os
import sys
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import alerts
from analytics import arbitrage as arb
from optimize import bess_mpc
from optimize import portfolio_cvar as pc

ORG = "11111111-2222-3333-4444-555555555555"
DAY = date(2026, 9, 3)
DAY_START = datetime(DAY.year, DAY.month, DAY.day, tzinfo=timezone.utc)


class FakeResp:
    def __init__(self, payload=None, ok=True):
        self._payload = payload if payload is not None else []
        self.ok = ok

    def json(self):
        return self._payload

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError("HTTP 500")


def _da_rows(zone, prices):
    """24 day-ahead market_price_history rows for `zone` on DAY."""
    return [{
        "timestamp": (DAY_START + timedelta(hours=h)).isoformat(),
        "zone": zone,
        "price_eur_mwh": prices[h],
    } for h in range(24)]


# ── emit_alert ────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _alert_env(monkeypatch):
    monkeypatch.setattr(alerts, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(alerts, "SUPABASE_SERVICE_ROLE_KEY", "svc-key")
    monkeypatch.setattr(alerts, "ALERT_WEBHOOK_URL", "")
    yield


def test_emit_alert_payload_shape(monkeypatch):
    calls = []
    monkeypatch.setattr(alerts.requests, "post",
                        lambda *a, **k: calls.append(k) or FakeResp(ok=True))
    ok = alerts.emit_alert(ORG, kind="drift", severity="warning",
                           title="Drift!", body="7d MAE up",
                           data={"model_kind": "price"})
    assert ok is True
    assert len(calls) == 1  # insert only — webhook unset
    assert calls[0]["json"] == {
        "organization_id": ORG,
        "kind": "drift",
        "severity": "warning",
        "title": "Drift!",
        "body": "7d MAE up",
        "data": {"model_kind": "price"},
    }
    assert calls[0]["headers"]["apikey"] == "svc-key"


def test_emit_alert_never_raises_on_http_error(monkeypatch):
    monkeypatch.setattr(alerts.requests, "post",
                        lambda *a, **k: FakeResp(ok=False))
    assert alerts.emit_alert(ORG, kind="rollback", title="rb") is False
    monkeypatch.setattr(alerts.requests, "post",
                        MagicMock(side_effect=ConnectionError("down")))
    assert alerts.emit_alert(ORG, kind="rollback", title="rb") is False


def test_emit_alert_webhook_skipped_when_unset(monkeypatch):
    posts = []
    monkeypatch.setattr(alerts.requests, "post",
                        lambda url, **k: posts.append(url) or FakeResp(ok=True))
    alerts.emit_alert(ORG, kind="system", title="t")
    assert posts == ["https://fake.supabase.co/rest/v1/alerts"]


def test_emit_alert_webhook_fires_when_set(monkeypatch):
    monkeypatch.setattr(alerts, "ALERT_WEBHOOK_URL", "https://hook.example/x")
    import threading
    started = []
    real_thread = threading.Thread

    class SpyThread(real_thread):
        def start(self):
            started.append(self)
            # do NOT actually start — fire-and-forget path stays offline

    monkeypatch.setattr(alerts.threading, "Thread", SpyThread)
    monkeypatch.setattr(alerts.requests, "post",
                        lambda *a, **k: FakeResp(ok=True))
    assert alerts.emit_alert(ORG, kind="system", title="t", body="b") is True
    assert len(started) == 1


# ── scan_arbitrage ────────────────────────────────────────────────────────

@pytest.fixture
def arb_env(monkeypatch):
    monkeypatch.setattr(arb, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(arb, "SUPABASE_SERVICE_ROLE_KEY", "svc-key")
    state = {"posted": [], "alerts": []}
    monkeypatch.setattr(arb, "emit_alert",
                        lambda *a, **k: state["alerts"].append((a, k)) or True)
    monkeypatch.setattr(arb.requests, "post",
                        lambda url, **k: state["posted"].append(k) or FakeResp(ok=True))
    return state


def test_scan_arbitrage_two_zones(monkeypatch, arb_env):
    mk = [50.0] * 24
    hu = [50.0] * 24
    hu[10] = 80.0   # one exportable hour: MK -> HU spread 30
    hu[11] = 30.0   # reverse hour: HU -> MK spread 20
    rows = _da_rows("MK", mk) + _da_rows("HU", hu)
    monkeypatch.setattr(arb.requests, "get", lambda *a, **k: FakeResp(rows))

    res = arb.scan_arbitrage(ORG, target_date=DAY, threshold_eur_mwh=10.0)
    assert res["date"] == DAY.isoformat()
    assert res["opportunities"] == 2
    assert res["best_spread"] == 30.0
    assert res["missing_zones"] == ["RS"]
    assert res["partial"] is True
    spreads = {(p["buy_zone"], p["sell_zone"], p["hour"]): p["spread_eur_mwh"]
               for p in res["pairs"]}
    assert spreads[("MK", "HU", 10)] == 30.0
    assert spreads[("HU", "MK", 11)] == 20.0
    # below-threshold hours excluded
    assert all(v >= 10.0 for v in spreads.values())

    # persistence: one POST, rows match the arbitrage_opportunities schema
    assert len(arb_env["posted"]) == 1
    payload = arb_env["posted"][0]["json"]
    assert len(payload) == 2
    for row in payload:
        assert set(row) == {"organization_id", "target_date", "buy_zone",
                            "sell_zone", "hour", "buy_price", "sell_price",
                            "spread_eur_mwh"}
        assert row["organization_id"] == ORG
        assert row["target_date"] == DAY.isoformat()
    # arbitrage alert emitted with best spread in body
    assert len(arb_env["alerts"]) == 1
    kw = arb_env["alerts"][0][1]
    assert kw["kind"] == "arbitrage" and kw["severity"] == "info"
    assert "30.00" in kw["body"]


def test_scan_arbitrage_missing_zone_partial(monkeypatch, arb_env):
    monkeypatch.setattr(arb.requests, "get",
                        lambda *a, **k: FakeResp(_da_rows("MK", [50.0] * 24)))
    res = arb.scan_arbitrage(ORG, target_date=DAY, threshold_eur_mwh=10.0)
    assert res["zones_scanned"] == ["MK"]
    assert res["missing_zones"] == ["HU", "RS"]
    assert res["partial"] is True
    assert res["opportunities"] == 0
    assert res["best_spread"] is None
    assert arb_env["posted"] == []   # nothing to persist
    assert arb_env["alerts"] == []   # no alert without opportunities


def test_scan_arbitrage_never_raises(monkeypatch, arb_env):
    monkeypatch.setattr(arb.requests, "get",
                        MagicMock(side_effect=ConnectionError("down")))
    res = arb.scan_arbitrage(ORG, target_date=DAY)
    assert res["opportunities"] == 0
    assert "error" in res


def test_default_target_date():
    before = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)
    after = datetime(2026, 9, 2, 13, 0, tzinfo=timezone.utc)
    assert arb.default_target_date(before) == date(2026, 9, 2)
    assert arb.default_target_date(after) == date(2026, 9, 3)


# ── optimize_bess_day ─────────────────────────────────────────────────────

SCHEDULE_COLS = {"organization_id", "asset_id", "delivery_date",
                 "hour_of_day", "charge_mw", "discharge_mw", "soc_pct",
                 "price_forecast_eur_mwh", "revenue_eur"}


@pytest.fixture
def bess_env(monkeypatch):
    monkeypatch.setattr(bess_mpc, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(bess_mpc, "SUPABASE_SERVICE_ROLE_KEY", "svc-key")
    state = {"posted": [], "deleted": []}
    monkeypatch.setattr(bess_mpc.requests, "post",
                        lambda url, **k: state["posted"].append(k) or FakeResp(ok=True))
    monkeypatch.setattr(bess_mpc.requests, "delete",
                        lambda url, **k: state["deleted"].append(k) or FakeResp(ok=True))
    return state


def _forecast_rows(day, base=40.0, newest_first=True):
    rows = [{
        "target_time": (datetime(day.year, day.month, day.day,
                                 tzinfo=timezone.utc) + timedelta(hours=h)).isoformat(),
        "p50": base + (h % 6) * 10,  # daily shape -> nonzero arbitrage
        "created_at": "2026-09-02T12:00:00+00:00",
    } for h in range(24)]
    return list(reversed(rows)) if newest_first else rows


def test_optimize_bess_day_forecast_path(monkeypatch, bess_env):
    def fake_get(url, **k):
        assert "forecast_predictions" in url
        return FakeResp(_forecast_rows(DAY))
    monkeypatch.setattr(bess_mpc.requests, "get", fake_get)

    res = bess_mpc.optimize_bess_day(ORG, target_date=DAY,
                                     p_max_mw=1.0, e_max_mwh=2.0)
    assert res["schedule_source"] == "forecast"
    assert res["hours"] == 24
    assert res["error"] if "error" in res else True
    assert res["expected_revenue_eur"] is not None
    assert res["cycles"] is not None
    assert res["persisted"] == 24

    # delete-then-insert (asset_id NULL cannot merge-dedupe); row shape
    # matches the real bess_dispatch_schedules columns
    assert len(bess_env["deleted"]) == 1
    assert bess_env["deleted"][0]["params"]["asset_id"] == "is.null"
    assert len(bess_env["posted"]) == 1
    payload = bess_env["posted"][0]["json"]
    assert len(payload) == 24
    for row in payload:
        assert set(row) == SCHEDULE_COLS
        assert row["organization_id"] == ORG
        assert row["asset_id"] is None
        assert row["delivery_date"] == DAY.isoformat()
        assert 0 <= row["hour_of_day"] <= 23
    assert sorted(r["hour_of_day"] for r in payload) == list(range(24))


def test_optimize_bess_day_fallback_path(monkeypatch, bess_env):
    last_week = DAY - timedelta(days=7)
    actuals = [{
        "timestamp": (datetime(last_week.year, last_week.month, last_week.day,
                               tzinfo=timezone.utc) + timedelta(hours=h)).isoformat(),
        "price_eur_mwh": 45.0 + (h % 8) * 5,
    } for h in range(24)]

    def fake_get(url, **k):
        if "forecast_predictions" in url:
            return FakeResp([])          # no forecast -> fallback
        assert "market_price_history" in url
        return FakeResp(actuals)
    monkeypatch.setattr(bess_mpc.requests, "get", fake_get)

    res = bess_mpc.optimize_bess_day(ORG, target_date=DAY)
    assert res["schedule_source"] == "fallback_actuals"
    assert res["hours"] == 24
    assert res["persisted"] == 24
    # forecast prices recorded are the fallback actuals, hour-aligned
    payload = bess_env["posted"][0]["json"]
    by_hour = {r["hour_of_day"]: r["price_forecast_eur_mwh"] for r in payload}
    assert by_hour[0] == 45.0 and by_hour[7] == 80.0


def test_optimize_bess_day_latest_forecast_wins(monkeypatch, bess_env):
    old = _forecast_rows(DAY, base=10.0)
    new = _forecast_rows(DAY, base=100.0)
    for r in old:
        r["created_at"] = "2026-09-01T12:00:00+00:00"
    # created_at desc ordering => all `new` rows precede `old` ones
    monkeypatch.setattr(bess_mpc.requests, "get",
                        lambda *a, **k: FakeResp(new + old))
    res = bess_mpc.optimize_bess_day(ORG, target_date=DAY)
    payload = bess_env["posted"][0]["json"]
    by_hour = {r["hour_of_day"]: r["price_forecast_eur_mwh"] for r in payload}
    assert by_hour[0] == 100.0   # newest issue, not the stale 10.0


def test_optimize_bess_day_no_data_never_raises(monkeypatch, bess_env):
    monkeypatch.setattr(bess_mpc.requests, "get", lambda *a, **k: FakeResp([]))
    res = bess_mpc.optimize_bess_day(ORG, target_date=DAY)
    assert res["schedule_source"] == "none"
    assert "error" in res
    assert bess_env["posted"] == []


# ── portfolio_cvar ────────────────────────────────────────────────────────

@pytest.fixture
def cvar_env(monkeypatch):
    monkeypatch.setattr(pc, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(pc, "SUPABASE_SERVICE_ROLE_KEY", "svc-key")
    return monkeypatch


def _quantile_rows(hours, p50=100.0, band=20.0):
    now = datetime.now(timezone.utc)
    return [{
        "target_time": (now + timedelta(hours=h + 1)).isoformat(),
        "p10": p50 - band / 2, "p50": p50, "p90": p50 + band / 2,
        "created_at": now.isoformat(),
    } for h in range(hours)]


def _trade_rows():
    now = datetime.now(timezone.utc)
    return [
        {"volume_mwh": 10.0, "side": "buy", "status": "confirmed",
         "delivery_start": (now + timedelta(hours=1)).isoformat()},
        {"volume_mwh": 4.0, "side": "sell", "status": "confirmed",
         "delivery_start": (now + timedelta(hours=2)).isoformat()},
        {"volume_mwh": 100.0, "side": "buy", "status": "cancelled",
         "delivery_start": (now + timedelta(hours=3)).isoformat()},
    ]


def test_portfolio_cvar_sigma_math(cvar_env):
    def fake_get(url, **k):
        if "trades" in url:
            return FakeResp(_trade_rows())
        assert "forecast_predictions" in url
        return FakeResp(_quantile_rows(48))
    cvar_env.setattr(pc.requests, "get", fake_get)

    res = pc.portfolio_cvar(ORG, days=2)
    assert res["basis"] == "forecast_quantiles"
    assert res["open_volume_mwh"] == 6.0        # 10 buy - 4 sell; cancelled skipped
    assert res["n_trades"] == 2
    assert res["scenarios"] == 2000
    assert res["horizon_hours"] == 48
    assert res["cvar95_eur"] >= res["var95_eur"] > 0

    # sigma = (p90 - p10) / 2.5631; with a 20-wide band sigma ~ 7.803 EUR/MWh
    sigma = 20.0 * pc.P10_P90_TO_SIGMA
    assert abs(sigma - 7.8029) < 1e-3
    # hourly sd of the position P&L ~= |vol| * sigma / sqrt(horizon)
    hourly_pnl_sd = abs(res["open_volume_mwh"]) * sigma / (48 ** 0.5)
    assert abs(res["var95_eur"] - 1.645 * hourly_pnl_sd) < 0.35 * hourly_pnl_sd


def test_portfolio_cvar_short_position_losses_on_price_drop(cvar_env):
    rows = _trade_rows()
    rows[0], rows[1] = rows[1], rows[0]
    rows[0]["volume_mwh"], rows[0]["side"] = 10.0, "sell"   # net -6 MWh
    rows[1]["volume_mwh"], rows[1]["side"] = 4.0, "buy"
    cvar_env.setattr(pc.requests, "get",
                     lambda url, **k: FakeResp(rows if "trades" in url
                                               else _quantile_rows(48)))
    res = pc.portfolio_cvar(ORG, days=2)
    assert res["open_volume_mwh"] == -6.0
    assert res["cvar95_eur"] > 0  # short loses when prices rise -> positive loss tail


def test_portfolio_cvar_insufficient_data(cvar_env):
    cvar_env.setattr(pc.requests, "get", lambda *a, **k: FakeResp([]))
    res = pc.portfolio_cvar(ORG, days=30)
    assert res["basis"] == "insufficient_data"
    assert res["cvar95_eur"] is None and res["var95_eur"] is None
    assert res["scenarios"] == 0
    assert res["open_volume_mwh"] == 0.0


def test_portfolio_cvar_no_open_position(cvar_env):
    cvar_env.setattr(pc.requests, "get",
                     lambda url, **k: FakeResp([] if "trades" in url
                                               else _quantile_rows(48)))
    res = pc.portfolio_cvar(ORG, days=2)
    assert res["basis"] == "insufficient_data"
    assert "no open position" in res.get("notes", "")


def test_portfolio_cvar_never_raises(cvar_env):
    cvar_env.setattr(pc.requests, "get",
                     MagicMock(side_effect=ConnectionError("down")))
    res = pc.portfolio_cvar(ORG)
    assert res["basis"] == "insufficient_data"


def test_cvar_from_scenarios_tail_mean():
    import numpy as np
    pnl = np.arange(-99, 1, dtype=float)  # losses 0..99
    out = pc.cvar_from_scenarios(pnl, beta=0.95)
    assert out["var"] == pytest.approx(94.05, abs=0.1)   # 95th pct of 0..99
    assert out["cvar"] == pytest.approx(97.0, abs=0.1)   # mean(95..99)
    assert out["cvar"] >= out["var"]


# ── Endpoint smoke tests (TestClient) ─────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    import main
    monkeypatch.setattr(main, "API_KEY", "test-key")
    from fastapi.testclient import TestClient
    return TestClient(main.app)


def test_endpoint_arbitrage_scan(client, monkeypatch):
    seen = {}
    def fake(org_id, target_date=None, threshold_eur_mwh=10.0):
        seen.update(org_id=org_id, target_date=target_date,
                    threshold=threshold_eur_mwh)
        return {"date": "2026-09-03", "opportunities": 1, "best_spread": 30.0,
                "pairs": [], "persisted": 1, "partial": True}
    monkeypatch.setattr("analytics.arbitrage.scan_arbitrage", fake)
    r = client.post("/arbitrage/scan?org_id=o1&threshold=15&target_date=2026-09-03",
                    headers={"X-API-Key": "test-key"})
    assert r.status_code == 200
    assert r.json()["best_spread"] == 30.0
    assert seen["org_id"] == "o1" and seen["threshold"] == 15.0
    assert seen["target_date"] == date(2026, 9, 3)


def test_endpoint_bess_optimize(client, monkeypatch):
    seen = {}
    def fake(org_id, target_date=None, p_max_mw=1.0, e_max_mwh=2.0):
        seen.update(org_id=org_id, p_max_mw=p_max_mw, e_max_mwh=e_max_mwh)
        return {"date": "2026-09-03", "expected_revenue_eur": 12.3,
                "cycles": 1.1, "schedule_source": "forecast"}
    monkeypatch.setattr("optimize.bess_mpc.optimize_bess_day", fake)
    r = client.post("/bess/optimize?org_id=o1&p_max_mw=2.5&e_max_mwh=5",
                    headers={"X-API-Key": "test-key"})
    assert r.status_code == 200
    assert r.json()["schedule_source"] == "forecast"
    assert seen == {"org_id": "o1", "p_max_mw": 2.5, "e_max_mwh": 5.0}


def test_endpoint_portfolio_cvar(client, monkeypatch):
    seen = {}
    def fake(org_id, days=30):
        seen.update(org_id=org_id, days=days)
        return {"open_volume_mwh": 6.0, "cvar95_eur": 123.4, "var95_eur": 100.0,
                "scenarios": 2000, "basis": "forecast_quantiles"}
    monkeypatch.setattr("optimize.portfolio_cvar.portfolio_cvar", fake)
    r = client.get("/portfolio/cvar?org_id=o1&days=7",
                   headers={"X-API-Key": "test-key"})
    assert r.status_code == 200
    assert r.json()["cvar95_eur"] == 123.4
    assert seen == {"org_id": "o1", "days": 7}


def test_endpoints_require_api_key(client):
    assert client.post("/arbitrage/scan?org_id=o1").status_code == 401
    assert client.post("/bess/optimize?org_id=o1").status_code == 401
    assert client.get("/portfolio/cvar?org_id=o1").status_code == 401
    # org_id is a required query param
    assert client.get("/portfolio/cvar",
                      headers={"X-API-Key": "test-key"}).status_code == 422


def test_health_version(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["version"] == "2.5.0"
