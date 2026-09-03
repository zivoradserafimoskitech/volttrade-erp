"""Load-module validation tests (Tier-1 load ML).

Run from python-service/:  python3 -m pytest tests/test_load_ml.py -v

Covers:
  - A65 / A44 fixture parsing (regression: A44 must be untouched)
  - train_load_model / predict_load smoke (lightgbm present + absent)
  - build_load_features with/without each optional extra
  - run_retrain(model_kind="load") end-to-end without Supabase
  - run_retrain(model_kind="price") regression (shape unchanged)
  - FastAPI: async /retrain + /retrain/status + /forecast/load + /health
"""

import os
import sys
import time

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ingest"))

FIXTURES = "/mnt/agents/work/fixtures"


# ── Fixture parsing ───────────────────────────────────────────────────────

def test_a65_fixture_parse():
    import backfill_history as bh
    with open(os.path.join(FIXTURES, "a65_sample.xml")) as fh:
        rows = bh.parse_a65(fh.read())
    # A01 sequential: exactly 3 points, NO gap-fill for missing positions
    assert len(rows) == 3
    vals = {ts.strftime("%H:%M"): v for ts, v in rows}
    assert vals["22:00"] == pytest.approx(512.5)
    assert vals["23:00"] == pytest.approx(498.2)
    assert vals["00:00"] == pytest.approx(487.9)


def test_a44_fixture_parse_regression():
    import backfill_history as bh
    with open(os.path.join(FIXTURES, "a44_sample.xml")) as fh:
        rows = bh.parse_a44(fh.read())
    vals = {ts.strftime("%H:%M"): v for ts, v in rows}
    assert vals["22:00"] == pytest.approx(94.50)
    assert vals["23:00"] == pytest.approx(93.90)
    assert vals["00:00"] == pytest.approx(-3.88)


# ── Load model smoke ──────────────────────────────────────────────────────

def _synthetic_series(days=120):
    rng = np.random.default_rng(7)
    idx = pd.date_range("2026-01-01", periods=days * 24, freq="h", tz="UTC")
    hour = idx.hour.to_numpy()
    dow = idx.dayofweek.to_numpy()
    load = 1.1 * (0.8 + 0.4 * np.sin(2 * np.pi * (hour - 7) / 24)) \
        * np.where(dow >= 5, 0.85, 1.0) \
        + rng.normal(0, 0.05, len(idx))
    return pd.DataFrame({"load_mw": np.clip(load, 0.05, None)}, index=idx)


def test_build_load_features_extras_optional():
    from models import load_forecast as lf
    idx = pd.date_range("2026-03-01", periods=72, freq="h", tz="UTC")

    base = lf.build_load_features(idx)
    for col in ("hour_sin", "dow_cos", "month_sin", "is_weekend",
                "day_type_sa", "day_type_su", "is_holiday"):
        assert col in base.columns
    assert "temperature" not in base.columns  # absent extra -> column gone

    temp = pd.Series(10.0 + np.arange(72) * 0.1, index=idx)
    zonal = pd.Series(500.0 + np.arange(72), index=idx)
    full = lf.build_load_features(idx, zonal_load=zonal, temperature=temp,
                                  holidays=[idx[0].date()])
    for col in ("temperature", "temperature_sq", "temp_x_hour",
                "zonal_load", "zonal_load_lag_24h"):
        assert col in full.columns
    assert full["is_holiday"].iloc[0] == 1
    assert full["day_type"].iloc[0] == "SU"  # holiday behaves like Sunday

    # All-NaN extras are dropped (cross_market convention)
    nan_temp = pd.Series(np.nan, index=idx)
    out = lf.build_load_features(idx, temperature=nan_temp)
    assert "temperature" not in out.columns


def test_train_and_predict_lightgbm():
    from models import load_forecast as lf
    if not lf.HAS_LIGHTGBM:
        pytest.skip("lightgbm not installed")
    series = _synthetic_series()
    model = lf.train_load_model(series, None, {"num_boost_round": 60})
    assert model["kind"] == "lightgbm_quantile"
    assert model["feature_cols"]
    assert set(model["models"].keys()) == {0.1, 0.5, 0.9}

    fc = lf.predict_load(model, 48, series.index[-1] + pd.Timedelta(hours=1))
    assert list(fc.columns) == ["timestamp", "p10_mw", "p50_mw", "p90_mw"]
    assert len(fc) == 48
    assert (fc["p10_mw"] <= fc["p50_mw"] + 1e-9).all()
    assert (fc["p50_mw"] <= fc["p90_mw"] + 1e-9).all()


def test_train_fallback_without_lightgbm(monkeypatch):
    from models import load_forecast as lf
    monkeypatch.setattr(lf, "HAS_LIGHTGBM", False)
    series = _synthetic_series(days=30)
    model = lf.train_load_model(series, None, None)
    assert model["kind"] == "seasonal_naive"  # graceful, never crashes
    fc = lf.predict_load(model, 24, series.index[-1] + pd.Timedelta(hours=1))
    assert len(fc) == 24
    assert (fc["p10_mw"] <= fc["p50_mw"] + 1e-9).all()
    assert (fc["p50_mw"] <= fc["p90_mw"] + 1e-9).all()


# ── Retrain pipeline ──────────────────────────────────────────────────────

def test_run_retrain_load_synthetic(tmp_path, monkeypatch):
    from retrain import pipeline
    monkeypatch.setattr(pipeline, "MODEL_DIR", str(tmp_path))
    result = pipeline.run_retrain(org_id=None, model_kind="load")
    assert set(result.keys()) == {"promoted", "champion_mae",
                                  "challenger_mae", "drift", "notes"}
    assert isinstance(result["promoted"], bool)
    assert isinstance(result["drift"], bool)
    assert result["champion_mae"] is None  # no registry without Supabase
    assert np.isfinite(result["challenger_mae"])
    # No persistence possible without org_id/supabase -> not promoted
    assert result["promoted"] is False


def test_run_retrain_price_unchanged(tmp_path, monkeypatch):
    from retrain import pipeline
    monkeypatch.setattr(pipeline, "MODEL_DIR", str(tmp_path))
    result = pipeline.run_retrain(org_id=None, model_kind="price")
    assert set(result.keys()) == {"promoted", "champion_mae",
                                  "challenger_mae", "drift", "notes"}
    assert isinstance(result["notes"], str)


def test_run_retrain_all_shape(tmp_path, monkeypatch):
    from retrain import pipeline
    monkeypatch.setattr(pipeline, "MODEL_DIR", str(tmp_path))
    result = pipeline.run_retrain(org_id=None, model_kind="all")
    assert set(result.keys()) == {"price", "load"}
    for part in ("price", "load"):
        assert set(result[part].keys()) == {"promoted", "champion_mae",
                                            "challenger_mae", "drift", "notes"}


# ── FastAPI endpoints ─────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client(tmp_path_factory):
    os.environ.setdefault("VOLTTRADE_ANALYTICS_KEY", "dev-key-change-in-production")
    import main
    from fastapi.testclient import TestClient
    return TestClient(main.app)


def _auth():
    return {"X-API-Key": os.environ.get("VOLTTRADE_ANALYTICS_KEY",
                                        "dev-key-change-in-production")}


def test_health_version(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["version"] == "2.5.0"


def test_retrain_async_roundtrip(client):
    resp = client.post("/retrain", params={"model_kind": "load"}, headers=_auth())
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "accepted"
    assert body["model_kind"] == "load"
    job_id = body["job_id"]

    deadline = time.time() + 60
    status = "running"
    result = None
    while time.time() < deadline:
        poll = client.get("/retrain/status", params={"job_id": job_id},
                          headers=_auth())
        assert poll.status_code == 200
        payload = poll.json()
        status = payload["status"]
        if status != "running":
            result = payload["result"]
            assert payload["error"] is None
            break
        time.sleep(1)
    assert status == "done"
    assert set(result.keys()) == {"promoted", "champion_mae",
                                  "challenger_mae", "drift", "notes"}


def test_retrain_rejects_bad_model_kind(client):
    resp = client.post("/retrain", params={"model_kind": "bogus"}, headers=_auth())
    assert resp.status_code == 422


def test_forecast_load_endpoint(client):
    resp = client.post("/forecast/load",
                       params={"horizon_hours": 48}, headers=_auth())
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] in ("champion", "adhoc")
    assert body["model"]
    fc = body["forecast"]
    assert len(fc) == 48
    for row in fc:
        assert set(row.keys()) == {"timestamp", "p10_mw", "p50_mw", "p90_mw"}
        assert row["p10_mw"] <= row["p50_mw"] + 1e-9
        assert row["p50_mw"] <= row["p90_mw"] + 1e-9


def test_preexisting_endpoints_still_work(client):
    # auth still enforced
    assert client.post("/forecast", json={}).status_code == 401
    # price forecast endpoint intact
    resp = client.post("/forecast", json={"model_type": "seasonal_naive",
                                          "horizon_hours": 24}, headers=_auth())
    assert resp.status_code == 200
    assert len(resp.json()["point_forecast"]) == 24
    # dispatch endpoint intact
    resp = client.post("/optimize/dispatch",
                       json={"prices": [50.0] * 24}, headers=_auth())
    assert resp.status_code == 200
    assert resp.json()["feasible"] is True
    # risk var intact
    resp = client.get("/risk/var", headers=_auth())
    assert resp.status_code == 200
    assert "var" in resp.json()
