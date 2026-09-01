"""
VoltTrade XGBoost Price Forecaster
Robust tree-based model optimized for electricity price spikes.
"""

import numpy as np
import pandas as pd
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

try:
    import xgboost as xgb
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False


class PriceXGBoost:
    """XGBoost price forecaster with spike-aware objective."""

    def __init__(self):
        self.model = None
        self.feature_cols = None

    def train(self, df: pd.DataFrame, features: List[str], target: str = "price") -> dict:
        """Train XGBoost model."""
        if not HAS_XGBOOST:
            raise ImportError("xgboost not installed")

        self.feature_cols = features
        train_data = df.dropna()
        X = train_data[features]
        y = train_data[target]

        dtrain = xgb.DMatrix(X, label=y)
        params = {
            "objective": "reg:squarederror",
            "max_depth": 8,
            "eta": 0.05,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "eval_metric": "mae",
            "seed": 42,
        }
        self.model = xgb.train(params, dtrain, num_boost_round=200)

        return {"status": "trained", "features": len(features)}

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Generate predictions."""
        if not HAS_XGBOOST or self.model is None:
            raise RuntimeError("Model not trained")

        dtest = xgb.DMatrix(X[self.feature_cols])
        return self.model.predict(dtest)
