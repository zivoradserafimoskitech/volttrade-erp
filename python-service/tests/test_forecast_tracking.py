"""Forecast accuracy tracking tests (SPEC-accuracy §2).

Run from python-service/:  python3 -m pytest tests/test_forecast_tracking.py -v

Covers:
  - accuracy_metrics math on hand-computed fixtures (mae/rmse/smape/bias/coverage)
  - log_predictions with mocked requests (payload shape, merge-duplicates
    Prefer header, never-raises on exception / missing config)
  - score_mature_predictions with mocked PostgREST responses (price + load
    actual joins, missing actuals counted, infra failure -> error dict)
"""

import os
import sys
from datetime import datetime, timezone
from math import sqrt

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracking import predictions


# ── Helpers ────────────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, payload=None, status=200):
        self._payload = payload if payload is not None else []
        self.status_code = status

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@pytest.fixture(autouse=True)
def sb_configured(monkeypatch):
    """Point the module-level PostgREST config at a fake project."""
    monkeypatch.setattr(predictions, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(predictions, "SUPABASE_SERVICE_ROLE_KEY", "svc-key")
    yield


# ── accuracy_metrics (pure math, hand-computed fixtures) ───────────────────

def test_accuracy_metrics_hand_computed():
    # p50 = [100, 200, 50], actuals = [110, 190, 40]
    # errors = [10, -10, -10]
    errors = [10.0, -10.0, -10.0]
    actuals = [110.0, 190.0, 40.0]
    p50 = [100.0, 200.0, 50.0]
    in_band = [True, False, True]

    m = predictions.accuracy_metrics(errors, actuals, p50, in_band)

    assert m["n"] == 3
    assert m["mae"] == pytest.approx(10.0)                    # 30/3
    assert m["rmse"] == pytest.approx(sqrt(300 / 3))          # sqrt(100) = 10
    assert m["bias"] == pytest.approx(-10.0 / 3.0)            # -10/3
    # per-row smape: 20/210*100, 20/390*100, 20/90*100
    expected_smape = (20 / 210 * 100 + 20 / 390 * 100 + 20 / 90 * 100) / 3
    assert m["smape"] == pytest.approx(expected_smape)
    assert m["coverage_p10_p90"] == pytest.approx(200.0 / 3.0)  # 2/3 * 100


def test_accuracy_metrics_zero_denominator_guard():
    # actual == p50 == 0 -> smape term skipped (guard), not a crash
    m = predictions.accuracy_metrics([0.0], [0.0], [0.0], [True])
    assert m["mae"] == 0.0
    assert m["rmse"] == 0.0
    assert m["bias"] == 0.0
    assert m["smape"] is None                      # no valid denominators
    assert m["coverage_p10_p90"] == 100.0


def test_accuracy_metrics_empty_inputs():
    m = predictions.accuracy_metrics([], [], [], [])
    assert m["n"] == 0
    assert m["mae"] is None
    assert m["rmse"] is None
    assert m["smape"] is None
    assert m["bias"] is None
    assert m["coverage_p10_p90"] is None


# ── log_predictions (mocked requests) ───────────────────────────────────────

def test_log_predictions_payload_shape(monkeypatch):
    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return _Resp(status=201)

    monkeypatch.setattr(predictions.requests, "post", fake_post)

    points = [
        {"target_time": "2026-09-02T10:00:00+00:00", "horizon_hours": 24,
         "p10": 95.0, "p50": 105.0, "p90": 120.0},
        {"target_time": "2026-09-02T11:00:00+00:00", "horizon_hours": 25,
         "p10": 96.0, "p50": 106.0, "p90": 121.0},
    ]
    n = predictions.log_predictions("org-1", "MK", "load", points,
                                    model_version="load-v42")

    assert n == 2
    assert captured["url"] == "https://fake.supabase.co/rest/v1/forecast_predictions"
    assert "merge-duplicates" in captured["headers"]["Prefer"]
    assert captured["headers"]["apikey"] == "svc-key"
    assert captured["headers"]["Authorization"] == "Bearer svc-key"

    rows = captured["json"]
    assert len(rows) == 2
    for row, p in zip(rows, points):
        assert row["organization_id"] == "org-1"
        assert row["zone"] == "MK"
        assert row["model_kind"] == "load"
        assert row["model_version"] == "load-v42"
        assert row["target_time"] == p["target_time"]
        assert row["horizon_hours"] == p["horizon_hours"]
        assert row["p10"] == p["p10"]
        assert row["p50"] == p["p50"]
        assert row["p90"] == p["p90"]
        assert "created_at" in row  # server-visible issue time
        # scorer-owned fields are never written by the logger
        assert "actual" not in row
        assert "scored_at" not in row


def test_log_predictions_never_raises_on_exception(monkeypatch):
    def boom(*args, **kwargs):
        raise ConnectionError("network down")

    monkeypatch.setattr(predictions.requests, "post", boom)
    n = predictions.log_predictions("org-1", "MK", "price",
                                    [{"target_time": "2026-09-02T10:00:00+00:00",
                                      "horizon_hours": 1, "p50": 1.0}])
    assert n == 0


def test_log_predictions_not_configured(monkeypatch):
    monkeypatch.setattr(predictions, "SUPABASE_URL", "")
    monkeypatch.setattr(predictions, "SUPABASE_SERVICE_ROLE_KEY", "")
    n = predictions.log_predictions("org-1", "MK", "load",
                                    [{"target_time": "2026-09-02T10:00:00+00:00",
                                      "horizon_hours": 1, "p50": 1.0}])
    assert n == 0


def test_log_predictions_http_error_returns_zero(monkeypatch):
    def fake_post(*args, **kwargs):
        return _Resp(status=500)

    monkeypatch.setattr(predictions.requests, "post", fake_post)
    n = predictions.log_predictions("org-1", "MK", "load",
                                    [{"target_time": "2026-09-02T10:00:00+00:00",
                                      "horizon_hours": 1, "p50": 1.0}])
    assert n == 0


# ── score_mature_predictions (mocked PostgREST) ─────────────────────────────

def _candidate_rows():
    base = {"organization_id": "org-1",
            "target_time": "2026-09-01T10:00:00+00:00"}
    return [
        dict(base, id="price-1", zone="MK", model_kind="price"),
        dict(base, id="load-1", zone="MK", model_kind="load"),
        dict(base, id="price-miss", zone="HR", model_kind="price"),
    ]


def test_score_mature_predictions_price_and_load(monkeypatch):
    get_calls = []
    patch_calls = []

    def fake_get(url, headers=None, params=None, timeout=None):
        get_calls.append({"url": url, "params": dict(params)})
        if url.endswith("/forecast_predictions"):
            # maturity filter must be applied
            assert params["actual"] == "is.null"
            assert params["target_time"].startswith("lte.")
            return _Resp(_candidate_rows())
        if url.endswith("/market_price_history"):
            assert params["product"] == "eq.day_ahead"
            if params["zone"] == "eq.HR":
                return _Resp([])                      # missing actual
            return _Resp([{"price_eur_mwh": 105.5}])
        if url.endswith("/load_history"):
            assert "product" not in params
            return _Resp([{"load_mw": 480.0}])
        raise AssertionError(f"unexpected GET {url}")

    def fake_patch(url, headers=None, params=None, json=None, timeout=None):
        patch_calls.append({"params": dict(params), "json": dict(json)})
        return _Resp(status=204)

    monkeypatch.setattr(predictions.requests, "get", fake_get)
    monkeypatch.setattr(predictions.requests, "patch", fake_patch)

    now = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)
    result = predictions.score_mature_predictions(now=now)

    assert result == {"candidates": 3, "scored": 2, "missing_actuals": 1}

    # maturity cutoff = now - 2h
    fp_get = get_calls[0]
    assert "2026-09-02T10:00:00" in fp_get["params"]["target_time"]

    # both actuals patched by id, with scored_at set
    assert len(patch_calls) == 2
    by_id = {c["params"]["id"]: c["json"] for c in patch_calls}
    assert by_id["eq.price-1"]["actual"] == pytest.approx(105.5)
    assert by_id["eq.load-1"]["actual"] == pytest.approx(480.0)
    assert by_id["eq.price-1"]["scored_at"] == now.isoformat()
    # missing actual -> no PATCH for price-miss
    assert "eq.price-miss" not in by_id

    # actual lookups joined on (org, timestamp, zone)
    price_lookup = next(c for c in get_calls if c["url"].endswith("/market_price_history"))
    assert price_lookup["params"]["organization_id"] == "eq.org-1"
    assert price_lookup["params"]["timestamp"] == "eq.2026-09-01T10:00:00+00:00"
    assert price_lookup["params"]["zone"] == "eq.MK"


def test_score_mature_predictions_never_raises_on_infra_failure(monkeypatch):
    def boom(*args, **kwargs):
        raise ConnectionError("postgrest unreachable")

    monkeypatch.setattr(predictions.requests, "get", boom)
    result = predictions.score_mature_predictions()
    assert result["candidates"] == 0
    assert result["scored"] == 0
    assert result["missing_actuals"] == 0
    assert "error" in result


def test_score_mature_predictions_not_configured(monkeypatch):
    monkeypatch.setattr(predictions, "SUPABASE_URL", "")
    monkeypatch.setattr(predictions, "SUPABASE_SERVICE_ROLE_KEY", "")
    result = predictions.score_mature_predictions()
    assert result["candidates"] == 0
    assert result["scored"] == 0
    assert result["missing_actuals"] == 0
    assert "error" in result
