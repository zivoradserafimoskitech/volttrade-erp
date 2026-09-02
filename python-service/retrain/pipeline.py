"""
VoltTrade Nightly Retrain Pipeline (Phase 2 + load module)

Champion-challenger retraining of the MEMO price forecast:
  1. Load recent price history (Supabase `market_price_history`, same
     degrade-gracefully data-access style as `ingest/memo_ingest.py`).
  2. Train a challenger (asinh transform + 90-day rolling window +
     cross-market features + HUPX transfer learning).
  3. Load the champion (active `forecast_models` row for the org).
  4. Backtest both on the last 14 days (MAE).
  5. Promote the challenger when it beats the champion by >= 1%.
  6. Drift detection: recent 7-day MAE vs trailing 30-day MAE (> 10% worse).

model_kind="load" runs the same champion-challenger protocol for the
portfolio LightGBM quantile load model (models/load_forecast.py, registry
model_type='lightgbm_load'); model_kind="all" runs both.

Everything degrades gracefully — missing Supabase config, empty price
history, or absent champion never crash the service.
"""

import os
import pickle
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import requests

from models.forecast_ensemble import ForecastEnsemble, HAS_LIGHTGBM
from models.cross_market import build_cross_market_features
from models import load_forecast as lf

logger = logging.getLogger(__name__)

DRIFT_THRESHOLD: float = 0.10          # alert if recent MAE > 10% worse than trailing MAE
PROMOTION_MIN_IMPROVEMENT: float = 0.01  # challenger must beat champion MAE by >= 1%

BACKTEST_DAYS = 14
DRIFT_RECENT_DAYS = 7
DRIFT_TRAILING_DAYS = 30
HISTORY_DAYS = 120  # > 90-day train window + backtest/drift windows
LOAD_HISTORY_DAYS = 365  # load challenger training window
LOAD_MODEL_TYPE = "lightgbm_load"
MODEL_KINDS = ("price", "load", "all")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
MODEL_DIR = os.getenv("MODEL_DIR", "./model_cache")


# ── Supabase access (PostgREST via `requests`, env-var configured) ────────

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


def _sb_insert(table: str, row: dict) -> bool:
    """INSERT a row into a Supabase table. Returns False on any failure."""
    if not _sb_configured():
        return False
    try:
        resp = requests.post(f"{SUPABASE_URL}/rest/v1/{table}",
                             headers=_sb_headers(), json=row, timeout=30)
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.warning(f"Supabase insert into {table} failed: {e}")
        return False


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


# ── Data loading ──────────────────────────────────────────────────────────

def _load_price_history(org_id: Optional[str], days: int = HISTORY_DAYS) -> pd.DataFrame:
    """Load recent price history from market_price_history (long format).

    Returns a DataFrame with columns timestamp, zone, price_eur_mwh.
    Empty frame when Supabase is not configured or no data exists.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    params = {
        "select": "timestamp,zone,price_eur_mwh",
        "timestamp": f"gte.{since}",
        "order": "timestamp.asc",
        "limit": "100000",
    }
    if org_id:
        params["organization_id"] = f"eq.{org_id}"

    rows = _sb_get("market_price_history", params)
    if not rows:
        logger.info("No price history loaded from Supabase")
        return pd.DataFrame(columns=["timestamp", "zone", "price_eur_mwh"])
    return pd.DataFrame(rows)


def _load_champion(org_id: Optional[str],
                   model_type: Optional[str] = None) -> Optional[dict]:
    """Load the active forecast_models row (the champion) for the org.

    `model_type` optionally restricts to one family (e.g. 'lightgbm_load');
    the default (None) preserves the original price-champion behavior.
    """
    if not org_id:
        return None
    params = {
        "organization_id": f"eq.{org_id}",
        "is_active": "eq.true",
        "order": "last_trained_at.desc",
        "limit": "1",
    }
    if model_type:
        params["model_type"] = f"eq.{model_type}"
    rows = _sb_get("forecast_models", params)
    if rows:
        return rows[0]
    return None


def _load_model_object(model_path: Optional[str]):
    """Load a pickled model from disk. Returns None when unavailable."""
    if not model_path or not os.path.exists(model_path):
        return None
    try:
        with open(model_path, "rb") as f:
            return pickle.load(f)
    except Exception as e:
        logger.warning(f"Failed to load model from {model_path}: {e}")
        return None


# ── Backtesting ───────────────────────────────────────────────────────────

def _predict_prices(ensemble: ForecastEnsemble, model_obj, X: pd.DataFrame) -> np.ndarray:
    """Predict with a challenger/champion model object (inverse-transformed)."""
    if isinstance(model_obj, dict) and "median" in model_obj:
        cols = model_obj.get("feature_cols")
        if cols:
            X = X.reindex(columns=cols)
        preds = model_obj["median"].predict(X)
        scale = model_obj.get("scale", 1.0)
        if model_obj.get("use_asinh", True):
            return np.sinh(np.asarray(preds, dtype=float)) * scale
        return np.asarray(preds, dtype=float)
    # Bare booster (e.g. older champion format) — assume raw price space
    return np.asarray(model_obj.predict(X), dtype=float)


def _backtest_mae(ensemble: ForecastEnsemble, frame: pd.DataFrame, model_obj,
                  days: int, end_offset_days: int = 0) -> Optional[float]:
    """MAE of `model_obj` over a `days`-long window ending `end_offset_days` ago.

    Falls back to a seasonal-naive backtest when no trained model is given.
    Returns None when the window has no usable samples.
    """
    try:
        feat = ensemble._build_features(frame.copy())
        feature_cols = [c for c in feat.columns
                        if c not in ["price", "timestamp"] and not feat[c].isna().all()]
        end = len(feat) - end_offset_days * 24 if end_offset_days else len(feat)
        start = max(0, end - days * 24)
        window = feat.iloc[start:end]
        actual = window["price"]
        valid = actual.notna()
        if valid.sum() < 24:
            return None

        if model_obj is not None:
            test = window.dropna(subset=feature_cols)
            if len(test) < 24:
                return None
            preds = _predict_prices(ensemble, model_obj, test[feature_cols])
            return float(np.mean(np.abs(test["price"].values - preds)))

        # Seasonal-naive fallback (same hour last week)
        naive = feat["price"].shift(168).iloc[start:end]
        mask = valid & naive.notna()
        if mask.sum() < 24:
            return None
        return float(np.mean(np.abs(actual[mask].values - naive[mask].values)))
    except Exception as e:
        logger.warning(f"Backtest failed ({e})")
        return None


# ── Price retrain (Phase 2 — original path, unchanged) ───────────────────

def _run_price_retrain(org_id: Optional[str] = None) -> Dict[str, Any]:
    """Run the champion-challenger price retrain. Never raises.

    Returns:
        {"promoted": bool, "champion_mae": float | None,
         "challenger_mae": float, "drift": bool, "notes": str}
    """
    notes: List[str] = []
    promoted = False
    champion_mae: Optional[float] = None
    drift = False

    ensemble = ForecastEnsemble(model_dir=MODEL_DIR)

    # 1. Load recent price history (long format: timestamp, zone, price_eur_mwh)
    prices = _load_price_history(org_id)
    if not _sb_configured():
        notes.append("supabase not configured — running on fallback data, no persistence")

    # 2. Cross-market features (NaN-filled when HU/RS missing)
    xmarket = build_cross_market_features(prices)

    if len(xmarket) and xmarket["memo_price"].notna().sum() >= 7 * 24:
        memo_df = pd.DataFrame({"price": xmarket["memo_price"]})
    else:
        notes.append("insufficient MEMO history — using synthetic fallback data")
        memo_df = ensemble._load_or_generate_data("MK")

    # HUPX frame for transfer learning (MEMO-only fallback when absent)
    hupx_df = None
    if len(prices):
        hu = prices[prices["zone"] == "HU"]
        if len(hu):
            hupx_df = pd.DataFrame(
                {"price": pd.to_numeric(hu["price_eur_mwh"], errors="coerce").values},
                index=pd.to_datetime(hu["timestamp"], utc=True),
            ).sort_index()
    if ensemble.pretrain_on_hupx(hupx_df):
        notes.append("pretrained on HUPX (transfer learning)")
    else:
        notes.append("no HUPX data — MEMO-only training")

    # Training frame: MEMO price + cross-market features (memo_price column
    # dropped — it is identical to the target; all-NaN columns dropped so
    # they don't empty the training set on dropna).
    xm = xmarket.drop(columns=["memo_price"], errors="ignore").dropna(axis=1, how="all")
    frame = memo_df.join(xm, how="left")

    # 3. Train the challenger on history excluding the backtest window
    challenger = None
    train_frame = frame.iloc[:-BACKTEST_DAYS * 24] if len(frame) > BACKTEST_DAYS * 24 else frame
    if HAS_LIGHTGBM:
        try:
            challenger = ensemble._train_lightgbm(train_frame)
            notes.append("challenger trained (asinh + 90d window + cross-market)")
        except Exception as e:
            logger.warning(f"Challenger training failed: {e}")
            notes.append(f"challenger training failed: {e}")
    else:
        notes.append("lightgbm unavailable — challenger scored with seasonal naive")

    # 4. Backtest on the last 14 days
    challenger_mae = _backtest_mae(ensemble, frame, challenger, BACKTEST_DAYS)
    if challenger_mae is None:
        challenger_mae = _backtest_mae(ensemble, frame, None, BACKTEST_DAYS)
    if challenger_mae is None:
        challenger_mae = float("nan")
        notes.append("backtest window empty — no MAE available")

    # 5. Load the champion and backtest it
    champion_row = _load_champion(org_id)
    champion_model = _load_model_object(champion_row.get("model_path")) if champion_row else None
    if champion_row:
        if champion_model is not None:
            champion_mae = _backtest_mae(ensemble, frame, champion_model, BACKTEST_DAYS)
        if champion_mae is None:
            raw = champion_row.get("mae")
            champion_mae = float(raw) if raw is not None else None
            if champion_mae is not None:
                notes.append("champion model not loadable — using recorded MAE")
    else:
        notes.append("no active champion found")

    # 6. Drift detection: recent 7d MAE vs trailing 30d MAE
    drift_model = champion_model if champion_model is not None else challenger
    recent_mae = _backtest_mae(ensemble, frame, drift_model, DRIFT_RECENT_DAYS)
    trailing_mae = _backtest_mae(ensemble, frame, drift_model,
                                 DRIFT_TRAILING_DAYS, end_offset_days=DRIFT_RECENT_DAYS)
    if recent_mae is not None and trailing_mae and trailing_mae > 0:
        drift = recent_mae > trailing_mae * (1 + DRIFT_THRESHOLD)
        if drift:
            notes.append(f"drift detected: recent 7d MAE {recent_mae:.2f} vs "
                         f"trailing 30d MAE {trailing_mae:.2f}")
        if champion_model is None and drift_model is not None:
            notes.append("drift computed with challenger (champion model unavailable)")
    else:
        notes.append("insufficient history for drift detection")

    # 7. Promotion decision
    if challenger is None:
        notes.append("no challenger model — promotion skipped")
    elif champion_mae is None or (
        not np.isnan(challenger_mae)
        and challenger_mae <= champion_mae * (1 - PROMOTION_MIN_IMPROVEMENT)
    ):
        promoted = True

    # 8. Persist the new champion
    if promoted and challenger is not None:
        os.makedirs(MODEL_DIR, exist_ok=True)
        model_name = f"memo-lightgbm-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"
        model_path = os.path.join(MODEL_DIR, f"{model_name}.pkl")
        try:
            with open(model_path, "wb") as f:
                pickle.dump(challenger, f)
        except Exception as e:
            logger.warning(f"Failed to persist challenger model: {e}")
            model_path = None

        capture_ratio_pct = None
        if not np.isnan(challenger_mae):
            mean_abs = float(np.abs(frame["price"].iloc[-BACKTEST_DAYS * 24:]).mean())
            if mean_abs > 0:
                capture_ratio_pct = round(max(0.0, 100.0 * (1 - challenger_mae / mean_abs)), 2)

        row = {
            "organization_id": org_id,
            "model_name": model_name,
            "model_type": "lightgbm",
            "horizon_hours": 24,
            "mae": None if np.isnan(challenger_mae) else round(challenger_mae, 4),
            "capture_ratio_pct": capture_ratio_pct,
            "last_trained_at": datetime.now(timezone.utc).isoformat(),
            "is_active": True,
            "model_path": model_path,
            "features_json": {"cross_market": True, "asinh": ensemble.use_asinh},
            "hyperparams_json": {
                "train_window_days": ensemble.train_window_days,
                "transfer_learning": ensemble._hupx_booster is not None,
            },
        }
        if org_id and _sb_configured():
            if _sb_insert("forecast_models", row):
                if champion_row and champion_row.get("id"):
                    _sb_update("forecast_models",
                               {"id": f"eq.{champion_row['id']}"},
                               {"is_active": False})
                notes.append(f"promoted challenger {model_name} (forecast_models updated)")
            else:
                promoted = False
                notes.append("forecast_models write failed — promotion rolled back")
        else:
            promoted = False
            notes.append("challenger won but promotion not persisted "
                         "(no org_id or supabase not configured)")

    result = {
        "promoted": promoted,
        "champion_mae": champion_mae,
        "challenger_mae": challenger_mae,
        "drift": drift,
        "notes": "; ".join(notes),
    }
    logger.info(f"Retrain finished: {result}")
    return result


# ── Load retrain (Tier-1 portfolio load model) ────────────────────────────

def _load_backtest_mae(model: Optional[dict], frame: pd.DataFrame,
                       days: int, end_offset_days: int = 0) -> Optional[float]:
    """P50 MAE of a load model over a `days`-long window ending
    `end_offset_days` ago (one-step-ahead protocol with true target lags).

    `model` None scores a seasonal-naive baseline (load_lag_168).
    Returns None when the window has no usable samples.
    """
    try:
        end = len(frame) - end_offset_days * 24 if end_offset_days else len(frame)
        start = max(0, end - days * 24)
        window = frame.iloc[start:end]
        actual = pd.to_numeric(window["load_mw"], errors="coerce")
        if actual.notna().sum() < 24:
            return None

        score_model = model if model is not None else {"kind": "seasonal_naive"}
        preds = lf.predict_frame(score_model, window)
        mask = actual.notna().values & ~np.isnan(preds)
        if mask.sum() < 24:
            return None
        return float(np.mean(np.abs(actual.values[mask] - preds[mask])))
    except Exception as e:
        logger.warning(f"Load backtest failed ({e})")
        return None


def _run_load_retrain(org_id: Optional[str] = None) -> Dict[str, Any]:
    """Champion-challenger retrain of the portfolio load model. Never raises.

    Same promotion/drift rules as the price path; registry rows use
    model_type='lightgbm_load'. Returns the same dict shape.
    """
    notes: List[str] = []
    promoted = False
    champion_mae: Optional[float] = None
    drift = False

    # 1. Portfolio load history (synthetic fallback is announced loudly
    #    inside load_portfolio_series)
    series = lf.load_portfolio_series(org_id, days=LOAD_HISTORY_DAYS)
    if not _sb_configured():
        notes.append("supabase not configured — running on fallback data, no persistence")

    # 2. Optional exogenous extras (temperature, zonal MK load, holidays)
    extras = pd.DataFrame(index=series.index)
    temp = lf.fetch_temperature(series.index[0], series.index[-1])
    if temp is not None:
        extras["temperature"] = temp.reindex(series.index)
        notes.append("temperature features from Open-Meteo")
    else:
        notes.append("no temperature data — calendar features only")
    zonal = lf.load_zonal_series(org_id, "MK", days=LOAD_HISTORY_DAYS)
    if zonal is not None:
        extras["zonal_load"] = zonal.reindex(series.index)
        notes.append("zonal MK load features from load_history (A65)")

    frame = lf.build_training_frame(series, extras)

    # 3. Train the challenger on history excluding the backtest window
    challenger = None
    train_series = (series.iloc[:-BACKTEST_DAYS * 24]
                    if len(series) > BACKTEST_DAYS * 24 else series)
    train_extras = extras.reindex(train_series.index)
    if lf.HAS_LIGHTGBM:
        challenger = lf.train_load_model(train_series, train_extras)
        if challenger.get("kind") == "lightgbm_quantile":
            notes.append("load challenger trained (LightGBM quantile P10/P50/P90)")
        else:
            notes.append("load challenger degraded to seasonal naive")
            challenger = None
    else:
        notes.append("lightgbm unavailable — challenger scored with seasonal naive")

    # 4. Backtest on the last 14 days
    challenger_mae = _load_backtest_mae(challenger, frame, BACKTEST_DAYS)
    if challenger_mae is None:
        challenger_mae = _load_backtest_mae(None, frame, BACKTEST_DAYS)
        if challenger_mae is not None:
            notes.append("challenger scored with seasonal-naive baseline")
    if challenger_mae is None:
        challenger_mae = float("nan")
        notes.append("backtest window empty — no MAE available")

    # 5. Load the active load champion and backtest it
    champion_row = _load_champion(org_id, model_type=LOAD_MODEL_TYPE)
    champion_model = (_load_model_object(champion_row.get("model_path"))
                      if champion_row else None)
    if champion_row:
        if champion_model is not None:
            champion_mae = _load_backtest_mae(champion_model, frame, BACKTEST_DAYS)
        if champion_mae is None:
            raw = champion_row.get("mae")
            champion_mae = float(raw) if raw is not None else None
            if champion_mae is not None:
                notes.append("champion model not loadable — using recorded MAE")
    else:
        notes.append("no active load champion found")

    # 6. Drift detection: recent 7d MAE vs trailing 30d MAE
    drift_model = champion_model if champion_model is not None else challenger
    recent_mae = _load_backtest_mae(drift_model, frame, DRIFT_RECENT_DAYS)
    trailing_mae = _load_backtest_mae(drift_model, frame, DRIFT_TRAILING_DAYS,
                                      end_offset_days=DRIFT_RECENT_DAYS)
    if recent_mae is not None and trailing_mae and trailing_mae > 0:
        drift = recent_mae > trailing_mae * (1 + DRIFT_THRESHOLD)
        if drift:
            notes.append(f"drift detected: recent 7d MAE {recent_mae:.3f} MW vs "
                         f"trailing 30d MAE {trailing_mae:.3f} MW")
        if champion_model is None and drift_model is not None:
            notes.append("drift computed with challenger (champion model unavailable)")
    else:
        notes.append("insufficient history for drift detection")

    # 7. Promotion decision (same rule as price: beat champion by >= 1%)
    if challenger is None:
        notes.append("no challenger model — promotion skipped")
    elif champion_mae is None or (
        not np.isnan(challenger_mae)
        and challenger_mae <= champion_mae * (1 - PROMOTION_MIN_IMPROVEMENT)
    ):
        promoted = True

    # 8. Persist the new champion
    if promoted and challenger is not None:
        os.makedirs(MODEL_DIR, exist_ok=True)
        model_name = f"portfolio-load-lightgbm-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"
        model_path = os.path.join(MODEL_DIR, f"{model_name}.pkl")
        try:
            with open(model_path, "wb") as f:
                pickle.dump(challenger, f)
        except Exception as e:
            logger.warning(f"Failed to persist load challenger model: {e}")
            model_path = None

        row = {
            "organization_id": org_id,
            "model_name": model_name,
            "model_type": LOAD_MODEL_TYPE,
            "horizon_hours": 48,
            "mae": None if np.isnan(challenger_mae) else round(challenger_mae, 4),
            "capture_ratio_pct": None,
            "last_trained_at": datetime.now(timezone.utc).isoformat(),
            "is_active": True,
            "model_path": model_path,
            "features_json": {
                "quantiles": list(lf.QUANTILES),
                "extras": challenger.get("extras_used", []),
            },
            "hyperparams_json": {"train_window_days": LOAD_HISTORY_DAYS},
        }
        if org_id and _sb_configured():
            if _sb_insert("forecast_models", row):
                if champion_row and champion_row.get("id"):
                    _sb_update("forecast_models",
                               {"id": f"eq.{champion_row['id']}"},
                               {"is_active": False})
                notes.append(f"promoted load challenger {model_name} (forecast_models updated)")
            else:
                promoted = False
                notes.append("forecast_models write failed — promotion rolled back")
        else:
            promoted = False
            notes.append("challenger won but promotion not persisted "
                         "(no org_id or supabase not configured)")

    result = {
        "promoted": promoted,
        "champion_mae": champion_mae,
        "challenger_mae": challenger_mae,
        "drift": drift,
        "notes": "; ".join(notes),
    }
    logger.info(f"Load retrain finished: {result}")
    return result


# ── Main entry point ──────────────────────────────────────────────────────

def run_retrain(org_id: Optional[str] = None,
                model_kind: str = "price") -> Dict[str, Any]:
    """Run the champion-challenger retrain. Never raises.

    model_kind:
      "price" — original Phase-2 price path. Returns
          {"promoted": bool, "champion_mae": float | None,
           "challenger_mae": float, "drift": bool, "notes": str}
      "load"  — portfolio load model path (same dict shape).
      "all"   — both, returns {"price": {...}, "load": {...}}.
    """
    if model_kind == "price":
        return _run_price_retrain(org_id)
    if model_kind == "load":
        return _run_load_retrain(org_id)
    if model_kind == "all":
        return {
            "price": _run_price_retrain(org_id),
            "load": _run_load_retrain(org_id),
        }
    raise ValueError(f"unknown model_kind {model_kind!r} (expected one of {MODEL_KINDS})")
