"""
VoltTrade Analytics Service v2.2
Native computation layer for VoltTrade ERP.

NOT a separate product — this is VoltTrade's math engine.

Endpoints:
  POST /forecast         Multi-model price forecasting
  POST /forecast/load    Portfolio load forecast (LightGBM quantile P10/P50/P90)
  POST /optimize/hedge   Stochastic LP + CVaR portfolio hedge optimization
  POST /optimize/dispatch BESS dispatch via LP
  POST /backtest         Walk-forward backtesting
  GET  /risk/var         Parametric VaR/CVaR
  POST /ingest/memo      MEMO price ingestion handler
  POST /ingest/entsoe    ENTSO-E data ingestion
  POST /retrain          ASYNC champion-challenger retrain (returns job_id)
  GET  /retrain/status   Poll an async retrain job

Models:
  - LightGBM (gradient boosting; quantile for load)
  - XGBoost (robust trees)
  - LSTM/GRU (deep sequence)
  - CNN (pattern detection)
  - TFT (attention-based multi-horizon)
  - Seasonal Naive (baseline)
  - Ensemble (weighted by inverse validation RMSE)
"""

import os
import sys
import json
import uuid
import threading
import numpy as np
import pandas as pd
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional, Literal, Any
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("volttrade-analytics")

app = FastAPI(
    title="VoltTrade Analytics",
    version="2.2.0",
    description="Native computation engine for VoltTrade ERP",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth ──────────────────────────────────────────────────────────────────
API_KEY = os.getenv("VOLTTRADE_ANALYTICS_KEY", "dev-key-change-in-production")

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.url.path in ["/health", "/docs", "/openapi.json", "/redoc"]:
        return await call_next(request)
    key = request.headers.get("X-API-Key", "")
    if key != API_KEY:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return await call_next(request)

# ── Request/Response Models ───────────────────────────────────────────────

class ForecastRequest(BaseModel):
    model_type: Literal["lightgbm", "xgboost", "lstm", "gru", "cnn", "tft", "ensemble", "seasonal_naive", "naive"] = "ensemble"
    horizon_hours: int = Field(default=24, ge=1, le=168)
    include_quantiles: bool = True
    as_of_date: Optional[str] = None
    zone: str = "MK"
    calibration_window_days: int = 45

class ForecastResponse(BaseModel):
    model_type: str
    horizon_hours: int
    point_forecast: List[float]
    quantiles: Optional[Dict[str, List[float]]]
    capture_ratio_pct: Optional[float]
    mae: Optional[float]
    coverage_pct: Optional[float]
    generated_at: str
    zone: str

class HedgeOptRequest(BaseModel):
    org_id: str
    target_hedge_ratio: Optional[float] = Field(default=None, ge=0, le=1)
    risk_aversion: float = Field(default=1.0, ge=0)
    scenarios: int = Field(default=2000, ge=100, le=10000)
    capital_at_risk_eur: float = Field(default=100000, ge=0)
    min_hedge_ratio: float = Field(default=0.0, ge=0, le=1)
    max_open_pct: float = Field(default=0.20, ge=0, le=1)
    sold_mwh: Optional[float] = None
    sold_price: Optional[float] = None
    bought_mwh: Optional[float] = None
    bought_price: Optional[float] = None

class HedgeOptResponse(BaseModel):
    org_id: str
    recommended_hedge_ratio: float
    expected_cost: float
    cvar95_cost: float
    var95_cost: float
    open_position_cost: float
    efficient_frontier: List[Dict[str, Any]]
    recommendation: str
    scenarios_used: int

class DispatchRequest(BaseModel):
    prices: List[float] = Field(..., min_length=1, max_length=168)
    battery_mw: float = Field(default=1.0, gt=0)
    battery_mwh: float = Field(default=2.0, gt=0)
    eta_c: float = Field(default=0.95, gt=0, le=1)
    eta_d: float = Field(default=0.95, gt=0, le=1)
    soc_start_pct: float = Field(default=50.0, ge=0, le=100)
    soc_min_pct: float = Field(default=5.0, ge=0, le=100)
    soc_max_pct: float = Field(default=95.0, ge=0, le=100)
    max_cycles: float = Field(default=1.5, gt=0)
    dt_hours: float = Field(default=1.0, gt=0)

class DispatchResponse(BaseModel):
    feasible: bool
    charge_schedule: List[float]
    discharge_schedule: List[float]
    soc_schedule_pct: List[float]
    revenue_eur: float
    net_profit_eur: float
    cycles_used: float
    solver_status: str

class BacktestRequest(BaseModel):
    strategy: Literal["naive", "seasonal_naive", "lightgbm", "xgboost", "ensemble", "perfect_foresight"] = "ensemble"
    start_date: str
    end_date: str
    battery_mw: float = Field(default=0.0, ge=0)
    battery_mwh: float = Field(default=0.0, ge=0)
    initial_capital: float = Field(default=10000, gt=0)
    zone: str = "MK"

class BacktestResponse(BaseModel):
    strategy: str
    total_profit_eur: float
    avg_daily_profit_eur: float
    max_drawdown_eur: float
    sharpe_ratio: float
    capture_ratio_pct: float
    win_rate_pct: float
    trades: int
    period_days: int
    battery_cycles_total: float

class VaRRequest(BaseModel):
    portfolio_value: float = Field(default=100000, gt=0)
    confidence: float = Field(default=0.95, ge=0.8, le=0.999)
    days: int = Field(default=1, ge=1, le=365)
    volatility: float = Field(default=0.25, gt=0)

# ── Lazy module loading ───────────────────────────────────────────────────

_modules_loaded = False
_models = {}

def _load_modules():
    global _modules_loaded, _models
    if _modules_loaded:
        return
    try:
        from models.forecast_ensemble import ForecastEnsemble
        from models.price_lstm import PriceLSTM
        from models.price_xgboost import PriceXGBoost
        from optimize.hedge_stochastic import HedgeOptimizer
        from optimize.bess_dispatch import BessDispatch
        from backtest.engine import BacktestEngine
        _models = {
            "forecast": ForecastEnsemble(),
            "lstm": PriceLSTM(),
            "xgboost": PriceXGBoost(),
            "hedge": HedgeOptimizer(),
            "dispatch": BessDispatch(),
            "backtest": BacktestEngine(),
        }
        _modules_loaded = True
        logger.info("All model modules loaded successfully")
    except Exception as e:
        logger.warning(f"Some model modules could not load: {e}")
        _modules_loaded = True  # Mark as loaded to avoid retry spam

# ── Endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "volttrade-analytics",
        "version": "2.2.0",
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.post("/forecast", response_model=ForecastResponse)
async def forecast(req: ForecastRequest):
    """Multi-model price forecast with conformalized quantile regression."""
    _load_modules()

    try:
        ensemble = _models.get("forecast")
        if ensemble is None:
            raise HTTPException(503, "Forecast module not available")

        result = ensemble.predict(
            horizon=req.horizon_hours,
            model_type=req.model_type,
            include_quantiles=req.include_quantiles,
            as_of=req.as_of_date,
            zone=req.zone,
            calibration_window=req.calibration_window_days,
        )
        return ForecastResponse(**result)
    except Exception as e:
        logger.error(f"Forecast error: {e}")
        raise HTTPException(500, f"Forecast failed: {str(e)}")

@app.post("/optimize/hedge", response_model=HedgeOptResponse)
async def optimize_hedge(req: HedgeOptRequest):
    """Stochastic LP + CVaR hedge optimization."""
    _load_modules()

    try:
        optimizer = _models.get("hedge")
        if optimizer is None:
            raise HTTPException(503, "Hedge optimizer not available")

        result = optimizer.optimize(
            capital=req.capital_at_risk_eur,
            risk_aversion=req.risk_aversion,
            min_hedge=req.min_hedge_ratio,
            max_open=req.max_open_pct,
            sold_mwh=req.sold_mwh,
            sold_price=req.sold_price,
            bought_mwh=req.bought_mwh,
            bought_price=req.bought_price,
            scenarios=req.scenarios,
        )
        return HedgeOptResponse(**result)
    except Exception as e:
        logger.error(f"Hedge optimization error: {e}")
        raise HTTPException(500, f"Optimization failed: {str(e)}")

@app.post("/optimize/dispatch", response_model=DispatchResponse)
async def optimize_dispatch(req: DispatchRequest):
    """BESS dispatch optimization via LP."""
    _load_modules()

    try:
        dispatcher = _models.get("dispatch")
        if dispatcher is None:
            raise HTTPException(503, "Dispatch module not available")

        result = dispatcher.optimize(
            prices=req.prices,
            p_max_mw=req.battery_mw,
            e_max_mwh=req.battery_mwh,
            eta_c=req.eta_c,
            eta_d=req.eta_d,
            soc_start=req.soc_start_pct / 100,
            soc_min=req.soc_min_pct / 100,
            soc_max=req.soc_max_pct / 100,
            max_cycles=req.max_cycles,
            dt_hours=req.dt_hours,
        )
        return DispatchResponse(**result)
    except Exception as e:
        logger.error(f"Dispatch error: {e}")
        raise HTTPException(500, f"Dispatch failed: {str(e)}")

@app.post("/backtest", response_model=BacktestResponse)
async def backtest(req: BacktestRequest):
    """Walk-forward backtest with lookahead protection."""
    _load_modules()

    try:
        engine = _models.get("backtest")
        if engine is None:
            raise HTTPException(503, "Backtest engine not available")

        result = engine.run(
            strategy=req.strategy,
            start=req.start_date,
            end=req.end_date,
            battery_mw=req.battery_mw,
            battery_mwh=req.battery_mwh,
            initial_capital=req.initial_capital,
            zone=req.zone,
        )
        return BacktestResponse(**result)
    except Exception as e:
        logger.error(f"Backtest error: {e}")
        raise HTTPException(500, f"Backtest failed: {str(e)}")

@app.get("/risk/var")
async def value_at_risk(
    portfolio_value: float = 100000,
    confidence: float = 0.95,
    days: int = 1,
    volatility: float = 0.25,
):
    """Parametric VaR/CVaR for quick risk checks."""
    z_scores = {0.8: 0.84, 0.9: 1.28, 0.95: 1.645, 0.99: 2.33}
    z = z_scores.get(confidence, 1.645)

    daily_vol = volatility / np.sqrt(365)
    horizon_vol = daily_vol * np.sqrt(days)

    var = portfolio_value * horizon_vol * z

    # CVaR for normal distribution: E[X | X > VaR] = phi(z) / (1 - Phi(z)) * sigma
    from scipy import stats
    phi_z = stats.norm.pdf(z)
    Phi_z = stats.norm.cdf(z)
    cvar_multiplier = phi_z / (1 - Phi_z)
    cvar = portfolio_value * horizon_vol * cvar_multiplier

    return {
        "portfolio_value": portfolio_value,
        "confidence": confidence,
        "horizon_days": days,
        "volatility_annual": volatility,
        "var": round(var, 2),
        "cvar": round(cvar, 2),
        "z_score": round(z, 3),
    }

@app.post("/ingest/memo")
async def ingest_memo(date: Optional[str] = None, org_id: Optional[str] = None):
    """Ingest MEMO day-ahead prices."""
    from ingest.memo_ingest import MemoIngest
    ingester = MemoIngest()
    result = ingester.fetch_and_store(date=date, org_id=org_id)
    return result

# ── Async retrain jobs ────────────────────────────────────────────────────
# In-memory job registry (module-level). Jobs persist their run_retrain
# result/exception when done; the pipeline itself persists champions to
# forecast_models, so results survive a service restart even when this
# registry does not.
RETRAIN_JOBS: Dict[str, Dict[str, Any]] = {}


def _run_retrain_job(job_id: str, org_id: Optional[str], model_kind: str):
    """Blocking job body — runs in a daemon thread (run_retrain is
    CPU/IO-blocking LightGBM work, so a plain thread is both simpler and
    more robust than create_task + to_thread: it does not depend on the
    app event loop being pumped between requests)."""
    from retrain.pipeline import run_retrain
    try:
        result = run_retrain(org_id=org_id, model_kind=model_kind)
        RETRAIN_JOBS[job_id].update(status="done", result=result)
    except Exception as e:
        logger.error(f"Retrain job {job_id} failed: {e}")
        RETRAIN_JOBS[job_id].update(status="failed", error=str(e))


@app.post("/retrain")
async def retrain(org_id: Optional[str] = None, model_kind: str = "price"):
    """Start an ASYNC champion-challenger retrain with drift detection.

    Returns immediately with a job_id; poll GET /retrain/status?job_id=...
    for the outcome. The pipeline persists promoted champions to
    forecast_models on its own.
    """
    if model_kind not in ("price", "load", "all"):
        raise HTTPException(422, f"model_kind must be one of price|load|all")
    job_id = str(uuid.uuid4())
    RETRAIN_JOBS[job_id] = {
        "status": "running",
        "result": None,
        "error": None,
        "model_kind": model_kind,
        "org_id": org_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    worker = threading.Thread(target=_run_retrain_job,
                              args=(job_id, org_id, model_kind),
                              name=f"retrain-{job_id[:8]}", daemon=True)
    worker.start()
    return {"job_id": job_id, "status": "accepted", "model_kind": model_kind}


@app.get("/retrain/status")
async def retrain_status(job_id: str):
    """Poll an async retrain job."""
    job = RETRAIN_JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, f"unknown job_id {job_id}")
    return {"status": job["status"], "result": job["result"], "error": job["error"]}


@app.post("/forecast/load")
async def forecast_load(org_id: Optional[str] = None, horizon_hours: int = 48):
    """Portfolio hourly load forecast (P10/P50/P90, MW).

    Uses the active load champion from the forecast_models registry when
    available; otherwise trains an ad-hoc model on the fly (synthetic
    fallback data when Supabase is not configured).
    """
    if horizon_hours < 1 or horizon_hours > 24 * 14:
        raise HTTPException(422, "horizon_hours must be between 1 and 336")
    try:
        from models import load_forecast as lf
        from retrain.pipeline import _load_champion, _load_model_object

        model = None
        model_name = None
        source = "adhoc"

        champion_row = _load_champion(org_id, model_type="lightgbm_load") if org_id else None
        if champion_row:
            candidate = _load_model_object(champion_row.get("model_path"))
            if candidate is not None:
                model = candidate
                model_name = champion_row.get("model_name")
                source = "champion"
            else:
                logger.warning("load champion row present but model not loadable — ad-hoc")

        if model is None:
            series = lf.load_portfolio_series(org_id, days=365)
            extras = pd.DataFrame(index=series.index)
            temp = lf.fetch_temperature(series.index[0], series.index[-1])
            if temp is not None:
                extras["temperature"] = temp.reindex(series.index)
            zonal = lf.load_zonal_series(org_id, "MK", days=365)
            if zonal is not None:
                extras["zonal_load"] = zonal.reindex(series.index)
            model = lf.train_load_model(series, extras)
            model_name = f"adhoc-{model.get('kind', 'seasonal_naive')}"

        start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        fc = lf.predict_load(model, horizon_hours, start)
        return {
            "forecast": fc.to_dict(orient="records"),
            "model": model_name,
            "source": source,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Load forecast error: {e}")
        raise HTTPException(500, f"Load forecast failed: {str(e)}")

# ── Run ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
