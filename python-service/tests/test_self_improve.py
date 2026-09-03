"""Self-improvement loop tests (SPEC-selfimprove §7).

Run from python-service/:  python3 -m pytest tests/test_self_improve.py -v

Covers:
  - live_accuracy math on mocked PostgREST pages; pagination; None on empty
  - check_live_drift: drift true/false, insufficient-data path (org-wide,
    per-kind result)
  - maybe_rollback: happy path (is_active flags flipped, restored_model_id),
    no_previous_champion, no_drift; never raises
  - self-tuning: grid activates only after 2 unpromoted retrain_log runs;
    best combo chosen by backtest MAE
  - drift_check_and_react: orchestration order (rollback before retrain),
    never-raises
  - retrain_log insert on every run; promotion metadata columns written
    (promoted_at / previous_champion_id / promotion_reason='challenger_won')
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from retrain import self_improve as si
from retrain import pipeline


@pytest.fixture(autouse=True)
def sb_configured(monkeypatch):
    """Point module-level PostgREST config at a fake project."""
    monkeypatch.setattr(si, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(si, "SUPABASE_SERVICE_ROLE_KEY", "svc-key")
    yield


def _scored_rows(n, err, start):
    """n scored forecast_predictions rows with constant |p50 - actual| = err."""
    return [{
        "p50": 100.0 + err,
        "actual": 100.0,
        "target_time": (start + timedelta(hours=i)).isoformat(),
    } for i in range(n)]


# ── live_accuracy ─────────────────────────────────────────────────────────

def test_live_accuracy_math_paginated(monkeypatch):
    """Two mocked PostgREST pages aggregate into one MAE."""
    now = datetime.now(timezone.utc)
    page1 = _scored_rows(si.PAGE_SIZE, 2.0, now - timedelta(days=2))
    page2 = _scored_rows(10, 4.0, now - timedelta(days=1))
    pages = [page1, page2]
    calls = []

    def fake_get(table, params):
        assert table == "forecast_predictions"
        assert params["actual"] == "not.is.null"
        assert params["model_kind"] == "eq.price"
        calls.append(params)
        return pages[len(calls) - 1]

    monkeypatch.setattr(si, "_sb_get", fake_get)
    out = si.live_accuracy("org-1", "price", days=3)
    n = si.PAGE_SIZE + 10
    assert out["n"] == n
    assert out["mae"] == pytest.approx((si.PAGE_SIZE * 2.0 + 10 * 4.0) / n)
    assert len(calls) == 2  # stopped at the short page
    assert calls[1]["offset"] == str(si.PAGE_SIZE)  # paginated


def test_live_accuracy_none_on_empty(monkeypatch):
    monkeypatch.setattr(si, "_sb_get", lambda table, params: [])
    assert si.live_accuracy("org-1", "price", days=1) is None


def test_live_accuracy_none_on_failure(monkeypatch):
    monkeypatch.setattr(si, "_sb_get", lambda table, params: None)
    assert si.live_accuracy("org-1", "load", days=7) is None


def test_live_accuracy_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(si, "SUPABASE_URL", "")
    assert si.live_accuracy("org-1", "price", days=1) is None


# ── check_live_drift ──────────────────────────────────────────────────────

def test_check_live_drift_true_and_false(monkeypatch):
    """price crosses the 10% threshold, load does not."""
    def fake_acc(org_id, kind, days):
        if kind == "price":
            return {"mae": 12.0, "n": 100} if days <= 7 else {"mae": 10.0, "n": 500}
        return {"mae": 10.5, "n": 100} if days <= 7 else {"mae": 10.0, "n": 500}

    monkeypatch.setattr(si, "live_accuracy", fake_acc)
    out = si.check_live_drift("org-1")
    assert set(out.keys()) == {"price", "load"}
    price = out["price"]
    assert price["drift"] is True              # 12.0 > 10.0 * 1.10
    assert price["recent_mae"] == 12.0
    assert price["trailing_mae"] == 10.0
    assert price["n_recent"] == 100
    load = out["load"]
    assert load["drift"] is False              # 10.5 <= 10.0 * 1.10
    assert load["reason"] == "no_drift"


def test_check_live_drift_insufficient_data(monkeypatch):
    def fake_acc(org_id, kind, days):
        return {"mae": 50.0, "n": 10} if days <= 7 else {"mae": 10.0, "n": 500}

    monkeypatch.setattr(si, "live_accuracy", fake_acc)
    out = si.check_live_drift("org-1")
    for kind in ("price", "load"):
        assert out[kind]["drift"] is False
        assert out[kind]["reason"] == "insufficient_live_data"


def test_check_live_drift_fresh_deploy(monkeypatch):
    monkeypatch.setattr(si, "live_accuracy", lambda *a, **k: None)
    out = si.check_live_drift("org-1")
    for kind in ("price", "load"):
        assert out[kind] == {"recent_mae": None, "trailing_mae": None,
                             "n_recent": 0, "drift": False,
                             "reason": "insufficient_live_data"}


# ── maybe_rollback ────────────────────────────────────────────────────────

PREV_ID = "11111111-1111-1111-1111-111111111111"
CUR_ID = "22222222-2222-2222-2222-222222222222"

DRIFTING = {"recent_mae": 12.0, "trailing_mae": 10.0, "n_recent": 100,
            "drift": True, "reason": "drift_detected"}
HEALTHY = {"recent_mae": 10.0, "trailing_mae": 10.0, "n_recent": 100,
           "drift": False, "reason": "no_drift"}


def _champion_row(**over):
    row = {
        "id": CUR_ID,
        "organization_id": "org-1",
        "model_type": "lightgbm",
        "is_active": True,
        "previous_champion_id": PREV_ID,
    }
    row.update(over)
    return row


def _install_rollback_mocks(monkeypatch, drift, champion_row, prev_exists=True):
    """Mock _kind_live_drift/_sb_get/_sb_update around a rollback scenario."""
    updates = []

    def fake_get(table, params):
        assert table == "forecast_models"
        if params.get("id") == f"eq.{PREV_ID}":
            return [{"id": PREV_ID, "is_active": False}] if prev_exists else []
        return [champion_row] if champion_row is not None else []

    def fake_update(table, params, body):
        updates.append((params, dict(body)))
        return True

    monkeypatch.setattr(si, "_kind_live_drift", lambda org_id, kind: drift)
    monkeypatch.setattr(si, "_sb_get", fake_get)
    monkeypatch.setattr(si, "_sb_update", fake_update)
    return updates


def test_maybe_rollback_happy_path(monkeypatch):
    updates = _install_rollback_mocks(monkeypatch, DRIFTING, _champion_row())
    out = si.maybe_rollback("org-1", "price")
    assert out["rolled_back"] is True
    assert out["restored_model_id"] == PREV_ID

    # Previous champion reactivated with rollback metadata...
    old_update = [u for u in updates if u[0].get("id") == f"eq.{PREV_ID}"]
    assert len(old_update) == 1
    assert old_update[0][1]["is_active"] is True
    assert old_update[0][1]["promotion_reason"] == "rollback"
    # ...and the current champion retired.
    cur_update = [u for u in updates if u[0].get("id") == f"eq.{CUR_ID}"]
    assert len(cur_update) == 1
    assert cur_update[0][1] == {"is_active": False}


def test_maybe_rollback_no_drift(monkeypatch):
    updates = _install_rollback_mocks(monkeypatch, HEALTHY, _champion_row())
    out = si.maybe_rollback("org-1", "price")
    assert out == {"rolled_back": False, "reason": "no_drift"}
    assert updates == []


def test_maybe_rollback_no_previous_champion(monkeypatch):
    updates = _install_rollback_mocks(
        monkeypatch, DRIFTING, _champion_row(previous_champion_id=None))
    out = si.maybe_rollback("org-1", "price")
    assert out == {"rolled_back": False, "reason": "no_previous_champion"}
    assert updates == []


def test_maybe_rollback_previous_champion_row_missing(monkeypatch):
    updates = _install_rollback_mocks(monkeypatch, DRIFTING, _champion_row(),
                                      prev_exists=False)
    out = si.maybe_rollback("org-1", "price")
    assert out == {"rolled_back": False, "reason": "no_previous_champion"}
    assert updates == []


def test_maybe_rollback_no_active_champion(monkeypatch):
    updates = _install_rollback_mocks(monkeypatch, DRIFTING, None)
    out = si.maybe_rollback("org-1", "price")
    assert out == {"rolled_back": False, "reason": "no_active_champion"}
    assert updates == []


def test_maybe_rollback_never_raises(monkeypatch):
    def boom(org_id, kind):
        raise RuntimeError("db on fire")

    monkeypatch.setattr(si, "_kind_live_drift", boom)
    out = si.maybe_rollback("org-1", "price")
    assert out["rolled_back"] is False
    assert out["reason"].startswith("error")


# ── self-tuning (SPEC §3.3 + §7) ─────────────────────────────────────────

def _log_rows(promoted_flags):
    return [{"promoted": p} for p in promoted_flags]


def test_self_tune_streak_requires_two_unpromoted(monkeypatch):
    """Grid activates only when the last 2 retrain_log rows are unpromoted."""
    monkeypatch.setattr(pipeline, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(pipeline, "SUPABASE_SERVICE_ROLE_KEY", "svc-key")

    cases = [
        (_log_rows([False, False]), True),    # two consecutive failures -> tune
        (_log_rows([False, True]), False),    # latest run promoted -> no tune
        (_log_rows([False]), False),          # fewer than 2 rows -> no tune
        ([], False),                          # fresh deploy -> no tune
        (None, False),                        # read failure -> no tune
    ]
    for rows, expected in cases:
        monkeypatch.setattr(pipeline, "_sb_get", lambda t, p, r=rows: r)
        assert pipeline._recent_unpromoted_streak("org-1", "price") is expected

    # No org_id -> never tune
    monkeypatch.setattr(pipeline, "_sb_get", lambda t, p: _log_rows([False, False]))
    assert pipeline._recent_unpromoted_streak(None, "price") is False


class _DummyModel(dict):
    """Picklable dummy challenger model keyed by its tuning variant."""


def _pipeline_harness(monkeypatch, tmp_path, streak, variant_maes):
    """Wire _run_price_retrain with fully mocked IO + training.

    Returns (inserted_rows, train_calls). `variant_maes` maps
    tuple(sorted(overrides.items())) -> backtest MAE; the default
    challenger (no overrides) uses variant_maes.get(None).
    """
    monkeypatch.setattr(pipeline, "MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(pipeline, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(pipeline, "SUPABASE_SERVICE_ROLE_KEY", "svc-key")

    inserted = []

    def fake_get(table, params):
        if table == "forecast_models":
            return []  # no champion -> promotion path stays open
        return []      # empty price history -> synthetic fallback data

    monkeypatch.setattr(pipeline, "_sb_get", fake_get)
    monkeypatch.setattr(pipeline, "_sb_insert",
                        lambda table, row: inserted.append((table, row)) or True)
    monkeypatch.setattr(pipeline, "_sb_update", lambda *a, **k: True)
    monkeypatch.setattr(pipeline, "_recent_unpromoted_streak",
                        lambda org_id, kind: streak)

    train_calls = []

    def fake_train(self, df, target_col="price", overrides=None):
        key = tuple(sorted(overrides.items())) if overrides else None
        train_calls.append(key)
        return _DummyModel(variant=key)

    monkeypatch.setattr(pipeline.ForecastEnsemble, "_train_lightgbm", fake_train)
    monkeypatch.setattr(pipeline.ForecastEnsemble, "pretrain_on_hupx",
                        lambda self, df: False)

    def fake_backtest(ensemble, frame, model_obj, days, end_offset_days=0):
        if isinstance(model_obj, _DummyModel):
            return variant_maes.get(model_obj.get("variant"), 5.0)
        return 5.0  # seasonal-naive / drift scoring

    monkeypatch.setattr(pipeline, "_backtest_mae", fake_backtest)
    return inserted, train_calls


def test_self_tuning_grid_picks_best_backtest_mae(monkeypatch, tmp_path):
    """After 2 unpromoted runs the grid trains and the best-MAE combo wins."""
    grid_keys = [tuple(sorted(v.items())) for v in pipeline.SELF_TUNE_GRID]
    # variant 2 (middle combo) is best
    maes = {grid_keys[0]: 9.0, grid_keys[1]: 4.0, grid_keys[2]: 7.0, None: 6.0}
    inserted, train_calls = _pipeline_harness(monkeypatch, tmp_path,
                                              streak=True, variant_maes=maes)

    result = pipeline.run_retrain(org_id="org-1", model_kind="price")

    assert set(train_calls) == set(grid_keys)      # all 3 grid combos trained
    assert grid_keys[1] in train_calls
    assert result["challenger_mae"] == pytest.approx(4.0)  # best combo kept
    assert "self-tuning" in result["notes"]
    assert "learning_rate" in result["notes"]      # chosen params recorded

    # The promoted registry row carries the tuned params
    fm_rows = [row for table, row in inserted if table == "forecast_models"]
    assert len(fm_rows) == 1
    assert fm_rows[0]["hyperparams_json"]["self_tuned"] is True
    assert fm_rows[0]["hyperparams_json"]["tuned_params"] == pipeline.SELF_TUNE_GRID[1]


def test_self_tuning_not_triggered_without_streak(monkeypatch, tmp_path):
    """Default path: single default-param challenger, no grid search."""
    maes = {None: 5.0}
    inserted, train_calls = _pipeline_harness(monkeypatch, tmp_path,
                                              streak=False, variant_maes=maes)
    result = pipeline.run_retrain(org_id="org-1", model_kind="price")

    assert train_calls == [None]                   # one default training run
    assert "self-tuning" not in result["notes"]
    fm_rows = [row for table, row in inserted if table == "forecast_models"]
    assert fm_rows[0]["hyperparams_json"]["self_tuned"] is False


# ── retrain_log insert + promotion metadata (SPEC §3.1/§3.2 + §7) ────────

def test_retrain_log_insert_on_run_and_promotion_metadata(monkeypatch, tmp_path):
    inserted, _ = _pipeline_harness(monkeypatch, tmp_path, streak=False,
                                    variant_maes={None: 5.0})
    result = pipeline.run_retrain(org_id="org-1", model_kind="price",
                                  trigger="live_drift")

    # One retrain_log row per run, trigger recorded as notes prefix.
    log_rows = [row for table, row in inserted if table == "retrain_log"]
    assert len(log_rows) == 1
    log = log_rows[0]
    assert log["organization_id"] == "org-1"
    assert log["model_kind"] == "price"
    assert log["notes"].startswith("trigger=live_drift")
    assert "trigger" not in log                  # no trigger column (SPEC §1)
    assert log["promoted"] is True               # no champion -> promotion
    assert log["challenger_mae"] == pytest.approx(5.0)
    assert "drift" in log and "champion_mae" in log

    # Promotion metadata written on the new champion row.
    fm_rows = [row for table, row in inserted if table == "forecast_models"]
    assert len(fm_rows) == 1
    fm = fm_rows[0]
    assert fm["is_active"] is True
    assert fm["promotion_reason"] == "challenger_won"
    assert fm["promoted_at"]                     # ISO timestamp set
    assert fm["previous_champion_id"] is None    # no prior champion existed


def test_promotion_records_previous_champion(monkeypatch, tmp_path):
    """previous_champion_id points at the displaced champion row."""
    inserted, _ = _pipeline_harness(monkeypatch, tmp_path, streak=False,
                                    variant_maes={None: 5.0})
    champion = {"id": CUR_ID, "model_path": None, "mae": 9999.0,
                "is_active": True, "model_type": "lightgbm"}
    monkeypatch.setattr(pipeline, "_load_champion",
                        lambda org_id, model_type=None: champion)
    updates = []
    monkeypatch.setattr(pipeline, "_sb_update",
                        lambda t, p, b: updates.append((p, b)) or True)

    result = pipeline.run_retrain(org_id="org-1", model_kind="price")
    assert result["promoted"] is True

    fm_rows = [row for table, row in inserted if table == "forecast_models"]
    assert fm_rows[0]["previous_champion_id"] == CUR_ID
    assert fm_rows[0]["promotion_reason"] == "challenger_won"
    assert any(p.get("id") == f"eq.{CUR_ID}" and b.get("is_active") is False
               for p, b in updates)              # old champion retired


# ── drift_check_and_react (SPEC §3.4 + §7) ───────────────────────────────

def test_drift_check_and_react_orchestration(monkeypatch):
    """Rollback runs BEFORE the retrain launch; drift kinds always retrain."""
    calls = []

    monkeypatch.setattr(pipeline.self_improve, "check_live_drift",
                        lambda org_id: {
                            "price": dict(DRIFTING),
                            "load": {"recent_mae": 10.0, "trailing_mae": 10.0,
                                     "n_recent": 100, "drift": False,
                                     "reason": "no_drift"},
                        })

    def fake_rollback(org_id, kind):
        calls.append(("rollback", kind))
        return {"rolled_back": True, "restored_model_id": PREV_ID}

    def fake_launch(org_id, kind, trigger="live_drift"):
        calls.append(("retrain", kind, trigger))
        return True

    monkeypatch.setattr(pipeline.self_improve, "maybe_rollback", fake_rollback)
    monkeypatch.setattr(pipeline, "_launch_retrain", fake_launch)

    out = pipeline.drift_check_and_react("org-1")

    assert out["drift"]["price"]["drift"] is True
    assert out["actions"] == [
        {"kind": "price", "rolled_back": True, "retrain": "started"},
        {"kind": "load", "rolled_back": False, "retrain": "skipped"},
    ]
    # rollback strictly before the retrain launch for the drifting kind
    assert calls == [("rollback", "price"), ("retrain", "price", "live_drift")]


def test_drift_check_and_react_no_drift_no_actions(monkeypatch):
    monkeypatch.setattr(pipeline.self_improve, "check_live_drift",
                        lambda org_id: {k: dict(HEALTHY) for k in ("price", "load")})
    rollback_spy = MagicMock(side_effect=AssertionError("no rollback w/o drift"))
    launch_spy = MagicMock(side_effect=AssertionError("no retrain w/o drift"))
    monkeypatch.setattr(pipeline.self_improve, "maybe_rollback", rollback_spy)
    monkeypatch.setattr(pipeline, "_launch_retrain", launch_spy)

    out = pipeline.drift_check_and_react("org-1")
    assert all(a["retrain"] == "skipped" and a["rolled_back"] is False
               for a in out["actions"])
    rollback_spy.assert_not_called()
    launch_spy.assert_not_called()


def test_drift_check_and_react_never_raises(monkeypatch):
    monkeypatch.setattr(pipeline.self_improve, "check_live_drift",
                        MagicMock(side_effect=RuntimeError("boom")))
    out = pipeline.drift_check_and_react("org-1")
    assert out["drift"] == {}
    assert len(out["actions"]) == 2

    # Drift reported, but rollback explodes -> retrain still launched.
    monkeypatch.setattr(pipeline.self_improve, "check_live_drift",
                        lambda org_id: {"price": dict(DRIFTING), "load": dict(HEALTHY)})
    monkeypatch.setattr(pipeline.self_improve, "maybe_rollback",
                        MagicMock(side_effect=RuntimeError("boom")))
    launched = []
    monkeypatch.setattr(pipeline, "_launch_retrain",
                        lambda org_id, kind, trigger="live_drift": launched.append(kind) or True)
    out = pipeline.drift_check_and_react("org-1")
    assert launched == ["price"]
    assert out["actions"][0] == {"kind": "price", "rolled_back": False,
                                 "retrain": "started"}
