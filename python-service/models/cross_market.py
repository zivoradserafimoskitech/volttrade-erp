"""
VoltTrade Cross-Market Features (Phase 2)

Builds HUPX (HU) and SEEPEX-proxy (RS) feature columns alongside MEMO (MK)
prices for the forecast ensemble. Cross-border prices are strong leading
indicators for MEMO day-ahead prices.

Everything degrades gracefully: missing HU/RS data produces NaN columns,
never an exception.
"""

import numpy as np
import pandas as pd
from typing import List
import logging

logger = logging.getLogger(__name__)

CROSS_MARKET_COLUMNS: List[str] = [
    "memo_price",
    "hupx_lag_24h",
    "seepex_lag_24h",
    "spread_memo_hupx",
    "spread_memo_seepex",
    "hupx_rolling_mean_7d",
    "seepex_rolling_mean_7d",
]


def build_cross_market_features(prices: pd.DataFrame) -> pd.DataFrame:
    """Build cross-market feature frame from long-format price history.

    Args:
        prices: long-format DataFrame with columns
            `timestamp` (tz-aware), `zone` ('MK'|'HU'|'RS'), `price_eur_mwh`.

    Returns:
        DataFrame indexed by timestamp with columns:
        `memo_price`, `hupx_lag_24h`, `seepex_lag_24h`, `spread_memo_hupx`,
        `spread_memo_seepex`, `hupx_rolling_mean_7d`, `seepex_rolling_mean_7d`.
        Missing HU/RS data yields NaN columns (not an error).
    """
    if prices is None or len(prices) == 0:
        logger.warning("No price history supplied — returning empty cross-market frame")
        return pd.DataFrame(columns=CROSS_MARKET_COLUMNS)

    try:
        df = prices.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df["price_eur_mwh"] = pd.to_numeric(df["price_eur_mwh"], errors="coerce")

        wide = (
            df.pivot_table(index="timestamp", columns="zone",
                           values="price_eur_mwh", aggfunc="mean")
              .sort_index()
        )

        def _zone_series(zone: str) -> pd.Series:
            if zone in wide.columns:
                return wide[zone].astype(float)
            logger.info(f"Zone {zone} missing from price history — NaN features")
            return pd.Series(np.nan, index=wide.index, dtype=float)

        memo = _zone_series("MK")
        hupx = _zone_series("HU")
        seepex = _zone_series("RS")

        out = pd.DataFrame(index=wide.index)
        out["memo_price"] = memo
        out["hupx_lag_24h"] = hupx.shift(24)
        out["seepex_lag_24h"] = seepex.shift(24)
        out["spread_memo_hupx"] = memo - hupx
        out["spread_memo_seepex"] = memo - seepex
        out["hupx_rolling_mean_7d"] = hupx.rolling(7 * 24, min_periods=1).mean()
        out["seepex_rolling_mean_7d"] = seepex.rolling(7 * 24, min_periods=1).mean()

        return out[CROSS_MARKET_COLUMNS]
    except Exception as e:
        logger.warning(f"Cross-market feature build failed ({e}) — returning empty frame")
        return pd.DataFrame(columns=CROSS_MARKET_COLUMNS)
