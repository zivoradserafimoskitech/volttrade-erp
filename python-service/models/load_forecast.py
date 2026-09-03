"""
VoltTrade Portfolio Load Forecasting (Tier-1 champion)

LightGBM QUANTILE regression for hourly portfolio load:
three boosters (objective='quantile', alpha=0.1/0.5/0.9) produce the
P10/P50/P90 bands used for nomination sizing and imbalance risk.

Conventions mirror models/forecast_ensemble.py:
  - optional lightgbm import with graceful fallback (seasonal-naive
    predictor when lightgbm is absent — never crash),
  - feature_cols carried inside the model dict,
  - all-NaN feature columns dropped (like models/cross_market.py),
  - Supabase access via PostgREST + env vars like retrain/pipeline.py,
    with a loud synthetic fallback when creds/data are missing.

ML load forecasting complements — does NOT replace — SLP settlement for
sub-40 kW consumers (those are settled on standard load profiles by the
DSO regardless of what the ML model predicts).
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import numpy as np
import pandas as pd
import requests

logger = logging.getLogger(__name__)

try:
    import lightgbm as lgb
    HAS_LIGHTGBM = True
except ImportError:
    HAS_LIGHTGBM = False
    logger.warning("lightgbm not installed — load model falls back to seasonal naive")

QUANTILES: Tuple[float, ...] = (0.1, 0.5, 0.9)
MAX_LAG_H = 168  # longest target lag used by the model

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

OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"

# Macedonian fixed-date public holidays (month, day) — fallback when the
# Supabase `public_holidays` table is unreachable. Movable feasts
# (Orthodox Easter Monday, Ramazan Bajram) are only covered via the table.
MK_FIXED_HOLIDAYS: Set[Tuple[int, int]] = {
    (1, 1),   # Нова Година
    (1, 7),   # Божик (православен)
    (5, 1),   # Ден на трудот
    (5, 24),  # Св. Кирил и Методиј
    (8, 2),   # Илинден
    (9, 8),   # Ден на независноста
    (10, 11), # Ден на народното востание
    (10, 23), # Ден на македонската револуционерна борба
    (12, 8),  # Св. Климент Охридски
}


# ── Supabase helpers (same style as retrain/pipeline.py) ─────────────────

def _sb_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _sb_headers() -> Dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
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


# ── Feature builder ───────────────────────────────────────────────────────

def _day_type(ts: pd.Timestamp, holiday_dates: Set) -> str:
    """Macedonian tariff day-type convention: WD workday / SA saturday /
    SU sunday-or-holiday."""
    if ts.dayofweek == 6 or ts.date() in holiday_dates:
        return "SU"
    if ts.dayofweek == 5:
        return "SA"
    return "WD"


def build_load_features(index: pd.DatetimeIndex,
                        zonal_load: Optional[pd.Series] = None,
                        temperature: Optional[pd.Series] = None,
                        holidays: Optional[Iterable] = None) -> pd.DataFrame:
    """Build calendar/weather/zonal features for load forecasting.

    Args:
        index: hourly DatetimeIndex to featurize.
        zonal_load: optional Series of zonal total load (MW) aligned (or
            alignable) to `index`; a 24h lag is derived automatically.
        temperature: optional Series of 2m temperature (°C).
        holidays: optional iterable of dates/datetimes/strings counted as
            non-working days (MK public holidays).

    All extras are optional and NaN-safe; columns that end up all-NaN are
    dropped (same convention as models/cross_market.py).
    """
    idx = pd.DatetimeIndex(index)
    df = pd.DataFrame(index=idx)

    hour = idx.hour
    dow = idx.dayofweek
    month = idx.month

    # Cyclical calendar encodings
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    df["dow_sin"] = np.sin(2 * np.pi * dow / 7)
    df["dow_cos"] = np.cos(2 * np.pi * dow / 7)
    df["month_sin"] = np.sin(2 * np.pi * month / 12)
    df["month_cos"] = np.cos(2 * np.pi * month / 12)
    df["is_weekend"] = (dow >= 5).astype(int)

    # Holiday set (dates) — NaN-safe against weird inputs
    holiday_dates: Set = set()
    if holidays is not None:
        for h in holidays:
            try:
                holiday_dates.add(pd.Timestamp(h).date())
            except Exception:
                continue

    day_types = [_day_type(ts, holiday_dates) for ts in idx]
    df["day_type"] = day_types  # informational (string), not fed to LightGBM
    df["day_type_sa"] = np.array([d == "SA" for d in day_types], dtype=int)
    df["day_type_su"] = np.array([d == "SU" for d in day_types], dtype=int)
    df["is_holiday"] = np.array([ts.date() in holiday_dates for ts in idx], dtype=int)

    # Temperature (°C) + saturation + evening-peak interaction
    if temperature is not None:
        temp = pd.to_numeric(
            pd.Series(temperature).reindex(idx), errors="coerce")
        df["temperature"] = temp
        df["temperature_sq"] = temp ** 2
        df["temp_x_hour"] = temp * hour

    # Zonal system load (MW) + 24h lag — strong cross-signal for portfolio load
    if zonal_load is not None:
        zl = pd.to_numeric(
            pd.Series(zonal_load).reindex(idx), errors="coerce")
        df["zonal_load"] = zl
        df["zonal_load_lag_24h"] = zl.shift(24)

    # Drop all-NaN columns (never the string day_type — it is never all-NaN)
    df = df.dropna(axis=1, how="all")
    return df


def _numeric_feature_cols(df: pd.DataFrame) -> List[str]:
    """Feature columns LightGBM can consume (numeric, non-empty)."""
    return [c for c in df.columns
            if c != "day_type"
            and pd.api.types.is_numeric_dtype(df[c])
            and not df[c].isna().all()]


def _add_target_lags(frame: pd.DataFrame, target: str = "load_mw") -> pd.DataFrame:
    """Append backward-looking target lags/rolling stats (no lookahead)."""
    out = frame.copy()
    for lag in (24, 48, 168):
        out[f"load_lag_{lag}"] = out[target].shift(lag)
    out["load_ma_24"] = out[target].shift(1).rolling(24).mean()
    out["load_ma_168"] = out[target].shift(1).rolling(168).mean()
    return out


# ── Training / prediction ─────────────────────────────────────────────────

def _split_extras(features_extra: Optional[pd.DataFrame]) -> Dict[str, Any]:
    """Pull optional exogenous columns out of a features_extra frame."""
    out: Dict[str, Any] = {"zonal_load": None, "temperature": None, "holidays": None}
    if features_extra is None or len(features_extra) == 0:
        return out
    for col in ("zonal_load", "temperature", "holidays"):
        if col in features_extra.columns:
            out[col] = features_extra[col]
    return out


def train_load_model(series: pd.DataFrame,
                     features_extra: Optional[pd.DataFrame] = None,
                     config: Optional[Dict[str, Any]] = None) -> dict:
    """Train the Tier-1 portfolio load model. Never raises.

    Args:
        series: DataFrame with a datetime index and a `load_mw` column
            (portfolio hourly load, MW).
        features_extra: optional DataFrame aligned to `series.index` with
            any of the columns `zonal_load`, `temperature`, `holidays`.
        config: optional dict overriding LightGBM params / rounds
            (keys: num_boost_round, learning_rate, num_leaves, params).

    Returns a model dict (picklable) carrying feature_cols and the history
    tail needed to seed recursive prediction. When lightgbm is absent or
    training fails, returns a seasonal-naive model dict instead.
    """
    cfg = dict(config or {})
    trained_at = datetime.now(timezone.utc).isoformat()

    base: Dict[str, Any] = {
        "kind": "seasonal_naive",
        "feature_cols": [],
        "trained_at": trained_at,
        "train_rows": 0,
        "history": [],
        "history_end": None,
    }

    try:
        df = series.copy()
        if "load_mw" not in df.columns:
            df = df.rename(columns={df.columns[0]: "load_mw"})
        df.index = pd.DatetimeIndex(df.index)
        if df.index.tz is None:
            df.index = df.index.tz_localize("UTC")
        df = df.sort_index()
        df["load_mw"] = pd.to_numeric(df["load_mw"], errors="coerce")
        df = df.dropna(subset=["load_mw"])

        tail = df["load_mw"].iloc[-MAX_LAG_H:]
        base["history"] = [float(v) for v in tail.values]
        base["history_end"] = (tail.index[-1].isoformat() if len(tail) else None)

        if not HAS_LIGHTGBM:
            logger.warning("lightgbm absent — load model is seasonal-naive")
            return base

        extras = _split_extras(features_extra)
        holidays = extras["holidays"]
        if holidays is None:
            holidays = fetch_holidays()
        feats = build_load_features(df.index,
                                    zonal_load=extras["zonal_load"],
                                    temperature=extras["temperature"],
                                    holidays=holidays)
        frame = df.join(feats.drop(columns=["day_type"], errors="ignore"))
        frame = _add_target_lags(frame)

        feature_cols = [c for c in _numeric_feature_cols(frame) if c != "load_mw"]
        train = frame.dropna(subset=feature_cols + ["load_mw"])
        if len(train) < 7 * 24:
            logger.warning(f"too few usable rows ({len(train)}) — seasonal-naive load model")
            return base

        params = {
            "objective": "quantile",
            "metric": "quantile",
            "boosting_type": "gbdt",
            "num_leaves": int(cfg.get("num_leaves", 31)),
            "learning_rate": float(cfg.get("learning_rate", 0.05)),
            "feature_fraction": 0.9,
            "bagging_fraction": 0.8,
            "bagging_freq": 5,
            "verbose": -1,
            "random_state": 42,
        }
        params.update(cfg.get("params", {}))
        rounds = int(cfg.get("num_boost_round", 300))

        X = train[feature_cols]
        y = train["load_mw"]
        models = {}
        for alpha in QUANTILES:
            q_params = dict(params)
            q_params["alpha"] = alpha
            models[alpha] = lgb.train(q_params, lgb.Dataset(X, label=y),
                                      num_boost_round=rounds)

        base.update({
            "kind": "lightgbm_quantile",
            "models": models,
            "feature_cols": feature_cols,
            "train_rows": len(train),
            "extras_used": [k for k in ("zonal_load", "temperature")
                            if extras.get(k) is not None],
        })
        logger.info(f"Load model trained: {len(train)} rows, "
                    f"{len(feature_cols)} features, quantiles {QUANTILES}")
        return base
    except Exception as e:
        logger.warning(f"Load model training failed ({e}) — seasonal-naive fallback")
        return base


def _predict_row(model: dict, X: pd.DataFrame) -> Tuple[float, float, float]:
    """(p10, p50, p90) for a single feature row, ordering enforced."""
    cols = model.get("feature_cols") or list(X.columns)
    X = X.reindex(columns=cols)
    preds = {a: float(model["models"][a].predict(X)[0]) for a in QUANTILES}
    p50 = preds[0.5]
    p10 = min(preds[0.1], p50)
    p90 = max(preds[0.9], p50)
    return p10, p50, p90


def predict_load(model: dict, horizon_hours: int, start: datetime) -> pd.DataFrame:
    """Forecast portfolio load. Never raises.

    Args:
        model: dict from train_load_model (or a loaded champion pickle).
        horizon_hours: number of hourly steps.
        start: first forecast hour (tz-aware or naive-UTC).

    Returns DataFrame with columns timestamp, p10_mw, p50_mw, p90_mw.
    """
    start_ts = pd.Timestamp(start)
    if start_ts.tzinfo is None:
        start_ts = start_ts.tz_localize("UTC")
    start_ts = start_ts.floor("h")
    future_idx = pd.date_range(start_ts, periods=horizon_hours, freq="h")

    history: List[float] = [float(v) for v in (model.get("history") or [])]
    if not history:
        history = [1.0] * 24  # degenerate but non-crashing
        logger.warning("load model carries no history — flat seasonal-naive")

    holidays = fetch_holidays()
    kind = model.get("kind", "seasonal_naive")
    rows: List[Dict[str, Any]] = []

    for ts in future_idx:
        if kind == "lightgbm_quantile" and model.get("models"):
            try:
                feats = build_load_features(pd.DatetimeIndex([ts]),
                                            holidays=holidays)
                feats = feats.drop(columns=["day_type"], errors="ignore")
                # Target lags from (real + already-predicted) history
                hist = pd.Series(history)
                feats["load_lag_24"] = hist.iloc[-24] if len(hist) >= 24 else np.nan
                feats["load_lag_48"] = hist.iloc[-48] if len(hist) >= 48 else np.nan
                feats["load_lag_168"] = hist.iloc[-168] if len(hist) >= 168 else np.nan
                feats["load_ma_24"] = hist.iloc[-24:].mean()
                feats["load_ma_168"] = hist.iloc[-168:].mean()
                p10, p50, p90 = _predict_row(model, feats)
            except Exception as e:
                logger.warning(f"LightGBM load predict failed ({e}) — seasonal-naive step")
                p50 = history[-168] if len(history) >= 168 else history[-24]
                p10, p90 = 0.85 * p50, 1.15 * p50
        else:
            # Seasonal naive: same hour last week (cycled), naive bands
            p50 = history[-168] if len(history) >= 168 else history[-24]
            p10, p90 = 0.85 * p50, 1.15 * p50

        p10, p50, p90 = float(p10), float(p50), float(p90)
        p10 = min(p10, p50)
        p90 = max(p90, p50)
        rows.append({"timestamp": ts.isoformat(),
                     "p10_mw": round(p10, 3),
                     "p50_mw": round(p50, 3),
                     "p90_mw": round(p90, 3)})
        history.append(p50)  # recursive: P50 feeds subsequent lags

    return pd.DataFrame(rows, columns=["timestamp", "p10_mw", "p50_mw", "p90_mw"])


def predict_frame(model: dict, frame: pd.DataFrame) -> np.ndarray:
    """One-step-ahead P50 predictions on a pre-built feature frame.

    Used for backtesting with TRUE target lags (standard day-ahead load
    backtest protocol). Falls back to load_lag_168 for naive models.
    """
    if model.get("kind") == "lightgbm_quantile" and model.get("models"):
        cols = model.get("feature_cols") or list(frame.columns)
        X = frame.reindex(columns=cols)
        return np.asarray(model["models"][0.5].predict(X), dtype=float)
    lag = frame.get("load_lag_168")
    if lag is not None:
        return pd.to_numeric(lag, errors="coerce").to_numpy(dtype=float)
    return np.full(len(frame), np.nan)


def build_training_frame(series: pd.DataFrame,
                         features_extra: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """Feature frame (calendar + extras + target lags) for a load series.

    Shared by training and backtesting so both see identical columns.
    """
    df = series.copy()
    if "load_mw" not in df.columns:
        df = df.rename(columns={df.columns[0]: "load_mw"})
    df.index = pd.DatetimeIndex(df.index)
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    df = df.sort_index()
    df["load_mw"] = pd.to_numeric(df["load_mw"], errors="coerce")
    extras = _split_extras(features_extra)
    holidays = extras["holidays"]
    if holidays is None:
        holidays = fetch_holidays()
    feats = build_load_features(df.index,
                                zonal_load=extras["zonal_load"],
                                temperature=extras["temperature"],
                                holidays=holidays)
    frame = df.join(feats.drop(columns=["day_type"], errors="ignore"))
    return _add_target_lags(frame)


# ── Data loading ──────────────────────────────────────────────────────────

def _synthetic_portfolio(days: int = 730) -> pd.DataFrame:
    """Synthetic 10 GWh/yr portfolio: daily + weekly + annual seasonality.

    Mean ~1.14 MW (10 GWh / 8760 h). Used ONLY as a fallback and always
    announced loudly in the logs.
    """
    logger.warning("******************************************************")
    logger.warning("SYNTHETIC PORTFOLIO LOAD in use (10 GWh/yr profile) —")
    logger.warning("Supabase creds or consumption data missing. DO NOT use")
    logger.warning("these forecasts for nominations.")
    logger.warning("******************************************************")
    rng = np.random.default_rng(42)
    idx = pd.date_range(datetime.now(timezone.utc) - timedelta(days=days),
                        periods=days * 24, freq="h")
    hour = idx.hour.to_numpy()
    dow = idx.dayofweek.to_numpy()
    doy = idx.dayofyear.to_numpy()

    daily = 0.75 + 0.45 * np.sin(2 * np.pi * (hour - 7) / 24) \
                  + 0.20 * np.sin(4 * np.pi * (hour - 7) / 24)
    weekly = np.where(dow >= 5, 0.82, 1.0)
    annual = 1.0 + 0.18 * np.cos(2 * np.pi * (doy - 15) / 365)  # winter peak
    noise = rng.normal(0, 0.05, len(idx))

    mean_mw = 10_000.0 / 8760.0  # 10 GWh/yr -> MW
    shape = daily * weekly * annual
    shape = shape / shape.mean()
    load = np.clip(mean_mw * shape * (1 + noise), 0.05, None)

    return pd.DataFrame({"load_mw": load}, index=idx)


def load_portfolio_series(org_id: Optional[str], days: int = 730) -> pd.DataFrame:
    """Aggregate the org's hourly portfolio load (sum across meters).

    Reads Supabase via PostgREST (service role):
      clients (organization_id) -> metering_points (client_id)
      -> consumption_readings.actual_mwh summed per reading_at hour.
    (1 MWh over a 1h reading interval = 1 MW average load.)

    Missing creds/data -> loud synthetic 10 GWh/yr portfolio fallback.
    Returns a DataFrame indexed by timestamp with column `load_mw`.
    """
    if not _sb_configured() or not org_id:
        if not org_id:
            logger.warning("load_portfolio_series: no org_id supplied")
        return _synthetic_portfolio(days)

    try:
        clients = _sb_get("clients", {
            "select": "id",
            "organization_id": f"eq.{org_id}",
            "limit": "10000",
        })
        client_ids = [c["id"] for c in (clients or [])]
        if not client_ids:
            logger.warning(f"no clients found for org {org_id}")
            return _synthetic_portfolio(days)

        meters = _sb_get("metering_points", {
            "select": "id",
            "client_id": "in.(" + ",".join(client_ids) + ")",
            "limit": "100000",
        })
        meter_ids = [m["id"] for m in (meters or [])]
        if not meter_ids:
            logger.warning(f"no metering points for org {org_id}")
            return _synthetic_portfolio(days)

        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        rows: List[dict] = []
        page_size = 50000
        # Paginate in chunks of meter ids to keep URLs sane
        for i in range(0, len(meter_ids), 200):
            chunk = meter_ids[i:i + 200]
            offset = 0
            while True:
                batch = _sb_get("consumption_readings", {
                    "select": "reading_at,actual_mwh",
                    "metering_point_id": "in.(" + ",".join(chunk) + ")",
                    "reading_at": f"gte.{since}",
                    "order": "reading_at.asc",
                    "limit": str(page_size),
                    "offset": str(offset),
                })
                if not batch:
                    break
                rows.extend(batch)
                if len(batch) < page_size:
                    break
                offset += page_size

        if not rows:
            logger.warning(f"no consumption readings for org {org_id}")
            return _synthetic_portfolio(days)

        df = pd.DataFrame(rows)
        df["timestamp"] = pd.to_datetime(df["reading_at"], utc=True)
        df["actual_mwh"] = pd.to_numeric(df["actual_mwh"], errors="coerce")
        hourly = (df.groupby("timestamp")["actual_mwh"].sum()
                    .sort_index().rename("load_mw").to_frame())
        logger.info(f"portfolio series for org {org_id}: {len(hourly)} hours "
                    f"({hourly.index[0]} .. {hourly.index[-1]})")
        return hourly
    except Exception as e:
        logger.warning(f"portfolio series load failed ({e}) — synthetic fallback")
        return _synthetic_portfolio(days)


def load_zonal_series(org_id: Optional[str], zone: str = "MK",
                      days: int = 730) -> Optional[pd.Series]:
    """Zonal total load from `load_history` (A65 backfill), or None."""
    if not _sb_configured() or not org_id:
        return None
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = _sb_get("load_history", {
        "select": "timestamp,load_mw",
        "organization_id": f"eq.{org_id}",
        "zone": f"eq.{zone}",
        "timestamp": f"gte.{since}",
        "order": "timestamp.asc",
        "limit": "100000",
    })
    if not rows:
        return None
    df = pd.DataFrame(rows)
    idx = pd.to_datetime(df["timestamp"], utc=True)
    return pd.Series(pd.to_numeric(df["load_mw"], errors="coerce").values,
                     index=idx, name="zonal_load").sort_index()


# ── Weather (Open-Meteo archive — free, no key) ───────────────────────────

def fetch_temperature(start: datetime, end: datetime,
                      lat: float = 42.0, lon: float = 21.43) -> Optional[pd.Series]:
    """Hourly 2m temperature (°C) from the Open-Meteo archive API.

    Defaults to Skopje (42.0 N, 21.43 E). Any failure returns None —
    features simply degrade (temperature columns are dropped as all-NaN).
    """
    try:
        resp = requests.get(OPEN_METEO_ARCHIVE, params={
            "latitude": lat,
            "longitude": lon,
            "start_date": pd.Timestamp(start).date().isoformat(),
            "end_date": pd.Timestamp(end).date().isoformat(),
            "hourly": "temperature_2m",
            "timezone": "UTC",
        }, timeout=(5, 15))  # (connect, read) — never stall the pipeline
        resp.raise_for_status()
        payload = resp.json()
        hourly = payload.get("hourly") or {}
        times = hourly.get("time") or []
        temps = hourly.get("temperature_2m") or []
        if not times or not temps:
            logger.warning("Open-Meteo returned no hourly temperature data")
            return None
        idx = pd.to_datetime(times, utc=True)
        return pd.Series(pd.to_numeric(temps, errors="coerce"), index=idx,
                         name="temperature")
    except Exception as e:
        logger.warning(f"Open-Meteo temperature fetch failed ({e})")
        return None


# ── Holidays ──────────────────────────────────────────────────────────────

def fetch_holidays() -> Set:
    """Macedonian holiday dates.

    Tries the Supabase `public_holidays` table first (includes movable
    feasts); falls back to the hardcoded fixed-date MK list otherwise.
    Returns a set of datetime.date objects.
    """
    rows = _sb_get("public_holidays", {"select": "holiday_date", "limit": "1000"})
    if rows:
        try:
            return {pd.Timestamp(r["holiday_date"]).date() for r in rows}
        except Exception as e:
            logger.warning(f"public_holidays parse failed ({e}) — fixed-date list")
    today = datetime.now(timezone.utc).date()
    years = range(today.year - 3, today.year + 3)
    return {datetime(y, m, d).date() for (m, d) in MK_FIXED_HOLIDAYS for y in years}
