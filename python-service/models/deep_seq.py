"""
VoltTrade deep sequence price forecasters — LSTM / GRU / CNN / TFT.

WHY THIS FILE EXISTS
--------------------
`ForecastEnsemble.AVAILABLE_MODELS` has advertised "lstm", "gru" and "cnn"
since the first version, but `predict()` had no branch for them — a request
for those models silently produced the generic ensemble. `price_lstm.py` held
a real LSTM, yet nothing called it and it had no GRU/CNN/TFT sibling.

This module implements all four as one small, uniform torch trainer so the
ensemble can route to them the same way it routes to LightGBM/XGBoost.

ARCHITECTURES
-------------
  lstm  — 2-layer bidirectional LSTM over the price sequence.
  gru   — 2-layer bidirectional GRU (cheaper, often on par with LSTM).
  cnn   — dilated causal 1-D convolutions; good at local spike shapes.
  tft   — a *compact* Temporal Fusion Transformer: GRU encoder → multi-head
          self-attention → gated residual network head. This is deliberately
          not `pytorch-forecasting`: that package pulls in a large dependency
          tree and expects a GPU budget we do not have. The gating +
          attention structure that gives TFT its behaviour is reproduced here
          at a size that trains on CPU in a couple of minutes.

MEMORY NOTE
-----------
Sized for a 2 GB / 1 CPU instance: hidden 64, ≤2 layers, batch 128, and the
training tensors are float32. A 3-year hourly series (~26k points, seq 168)
is roughly 26k × 168 × 4 B ≈ 17 MB per copy — fine. Do not raise
`seq_length` past ~336 or `hidden_size` past ~128 without more RAM.
"""

from __future__ import annotations

import logging
import math
import os
from typing import List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
except ImportError:  # pragma: no cover - exercised only on slim installs
    HAS_TORCH = False
    logger.warning("torch not installed — LSTM/GRU/CNN/TFT unavailable")


KINDS = ("lstm", "gru", "cnn", "tft")

# Minimum usable history. With seq_length=168 a model needs at least a few
# hundred training windows before it is anything other than a memoriser.
MIN_POINTS = 1500


if HAS_TORCH:

    class _RecurrentNet(nn.Module):
        """Bidirectional LSTM or GRU encoder with a linear head."""

        def __init__(self, kind: str, hidden: int = 64, layers: int = 2, dropout: float = 0.1):
            super().__init__()
            cell = nn.LSTM if kind == "lstm" else nn.GRU
            self.rnn = cell(
                input_size=1, hidden_size=hidden, num_layers=layers,
                batch_first=True, bidirectional=True,
                dropout=dropout if layers > 1 else 0.0,
            )
            self.head = nn.Sequential(nn.Linear(hidden * 2, hidden), nn.ReLU(), nn.Linear(hidden, 1))

        def forward(self, x):                      # x: (B, T, 1)
            out, _ = self.rnn(x)
            return self.head(out[:, -1, :])        # last step → (B, 1)

    class _DilatedCNN(nn.Module):
        """Causal dilated conv stack — a compact WaveNet-style encoder."""

        def __init__(self, channels: int = 48, dilations=(1, 2, 4, 8, 16, 32)):
            super().__init__()
            blocks = []
            in_ch = 1
            for d in dilations:
                blocks.append(nn.Conv1d(in_ch, channels, kernel_size=3, dilation=d, padding=d))
                blocks.append(nn.ReLU())
                in_ch = channels
            self.conv = nn.Sequential(*blocks)
            self.head = nn.Sequential(nn.Linear(channels, channels), nn.ReLU(), nn.Linear(channels, 1))

        def forward(self, x):                      # x: (B, T, 1)
            h = self.conv(x.transpose(1, 2))       # (B, C, T)
            return self.head(h[:, :, -1])

    class _GatedResidual(nn.Module):
        """TFT's Gated Residual Network: dense → ELU → dense → GLU → add+norm."""

        def __init__(self, size: int, dropout: float = 0.1):
            super().__init__()
            self.fc1 = nn.Linear(size, size)
            self.fc2 = nn.Linear(size, size)
            self.gate = nn.Linear(size, size * 2)
            self.drop = nn.Dropout(dropout)
            self.norm = nn.LayerNorm(size)

        def forward(self, x):
            h = self.fc2(torch.nn.functional.elu(self.fc1(x)))
            h = self.drop(h)
            h = nn.functional.glu(self.gate(h), dim=-1)
            return self.norm(x + h)

    class _CompactTFT(nn.Module):
        """GRU encoder → interpretable multi-head attention → gated head."""

        def __init__(self, hidden: int = 64, heads: int = 4, dropout: float = 0.1):
            super().__init__()
            self.input_proj = nn.Linear(1, hidden)
            self.encoder = nn.GRU(hidden, hidden, num_layers=1, batch_first=True)
            self.pre_attn = _GatedResidual(hidden, dropout)
            self.attn = nn.MultiheadAttention(hidden, heads, dropout=dropout, batch_first=True)
            self.post_attn = _GatedResidual(hidden, dropout)
            self.head = nn.Linear(hidden, 1)

        def forward(self, x):                      # x: (B, T, 1)
            h = self.input_proj(x)
            h, _ = self.encoder(h)
            h = self.pre_attn(h)
            a, _ = self.attn(h[:, -1:, :], h, h)   # query = last step
            h = self.post_attn(h[:, -1, :] + a[:, 0, :])
            return self.head(h)


def _build(kind: str, hidden: int):
    if kind in ("lstm", "gru"):
        return _RecurrentNet(kind, hidden=hidden)
    if kind == "cnn":
        return _DilatedCNN()
    if kind == "tft":
        return _CompactTFT(hidden=hidden)
    raise ValueError(f"unknown deep model kind '{kind}'")


class DeepSequenceForecaster:
    """Train-and-forecast wrapper shared by all four deep architectures.

    The target is standardised (z-score) before training and de-standardised
    on the way out; electricity prices span negatives to spikes, so a plain
    min-max scaler would compress the useful range.
    """

    def __init__(self, kind: str, seq_length: int = 168, hidden_size: int = 64,
                 model_dir: str = "./model_cache"):
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}")
        self.kind = kind
        self.seq_length = seq_length
        self.hidden_size = hidden_size
        self.model_dir = model_dir
        self.model = None
        self.mean_ = 0.0
        self.std_ = 1.0
        self.val_mae: Optional[float] = None

    # ── persistence ──────────────────────────────────────────────────────
    def _path(self, zone: str) -> str:
        return os.path.join(self.model_dir, f"{self.kind}_{zone}.pt")

    def save(self, zone: str) -> None:
        if not HAS_TORCH or self.model is None:
            return
        os.makedirs(self.model_dir, exist_ok=True)
        torch.save({
            "state": self.model.state_dict(),
            "mean": self.mean_, "std": self.std_,
            "seq_length": self.seq_length, "hidden": self.hidden_size,
            "val_mae": self.val_mae,
        }, self._path(zone))

    def load(self, zone: str) -> bool:
        if not HAS_TORCH or not os.path.exists(self._path(zone)):
            return False
        try:
            blob = torch.load(self._path(zone), map_location="cpu", weights_only=False)
            self.seq_length = blob.get("seq_length", self.seq_length)
            self.hidden_size = blob.get("hidden", self.hidden_size)
            self.mean_ = blob["mean"]
            self.std_ = blob["std"]
            self.val_mae = blob.get("val_mae")
            self.model = _build(self.kind, self.hidden_size)
            self.model.load_state_dict(blob["state"])
            self.model.eval()
            return True
        except Exception as e:
            logger.warning(f"failed to load cached {self.kind}: {e}")
            return False

    # ── training ─────────────────────────────────────────────────────────
    def _windows(self, series: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        n = len(series) - self.seq_length
        X = np.lib.stride_tricks.sliding_window_view(series[:-1], self.seq_length)[:n]
        y = series[self.seq_length:]
        return X.astype(np.float32), y.astype(np.float32)

    def train(self, series: np.ndarray, epochs: int = 30, batch_size: int = 128,
              lr: float = 1e-3, val_hours: int = 336, patience: int = 5) -> dict:
        """Fit on a 1-D hourly price series. Returns training diagnostics."""
        if not HAS_TORCH:
            raise ImportError("torch is required for deep sequence models")
        series = np.asarray(series, dtype=np.float64)
        series = series[np.isfinite(series)]
        if len(series) < MIN_POINTS:
            raise ValueError(
                f"{self.kind} needs at least {MIN_POINTS} hourly points "
                f"(got {len(series)}) — use LightGBM until history grows")

        self.mean_ = float(np.mean(series))
        self.std_ = float(np.std(series)) or 1.0
        z = (series - self.mean_) / self.std_

        X, y = self._windows(z)
        split = max(1, len(X) - val_hours)
        Xtr, ytr, Xva, yva = X[:split], y[:split], X[split:], y[split:]

        torch.manual_seed(42)
        torch.set_num_threads(1)  # 1 vCPU instance: extra threads only thrash
        self.model = _build(self.kind, self.hidden_size)
        opt = torch.optim.Adam(self.model.parameters(), lr=lr)
        sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, factor=0.5, patience=2)
        lossf = nn.HuberLoss(delta=1.0)  # robust to price spikes

        Xtr_t = torch.from_numpy(Xtr).unsqueeze(-1)
        ytr_t = torch.from_numpy(ytr).unsqueeze(-1)
        Xva_t = torch.from_numpy(Xva).unsqueeze(-1)
        yva_t = torch.from_numpy(yva).unsqueeze(-1)

        best = math.inf
        best_state = None
        bad = 0
        for epoch in range(epochs):
            self.model.train()
            perm = torch.randperm(len(Xtr_t))
            for i in range(0, len(perm), batch_size):
                idx = perm[i:i + batch_size]
                opt.zero_grad()
                loss = lossf(self.model(Xtr_t[idx]), ytr_t[idx])
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                opt.step()

            self.model.eval()
            with torch.no_grad():
                vmae = float(torch.mean(torch.abs(self.model(Xva_t) - yva_t)))
            sched.step(vmae)
            if vmae < best - 1e-4:
                best, bad = vmae, 0
                best_state = {k: v.clone() for k, v in self.model.state_dict().items()}
            else:
                bad += 1
                if bad >= patience:
                    logger.info(f"{self.kind}: early stop at epoch {epoch}")
                    break

        if best_state is not None:
            self.model.load_state_dict(best_state)
        self.model.eval()
        self.val_mae = best * self.std_  # back to EUR/MWh
        return {
            "kind": self.kind,
            "points": len(series),
            "train_windows": len(Xtr),
            "val_mae_eur_mwh": round(self.val_mae, 2),
        }

    # ── inference ────────────────────────────────────────────────────────
    def predict(self, history: np.ndarray, horizon: int = 24) -> List[float]:
        """Recursive multi-step forecast from the tail of `history`."""
        if not HAS_TORCH or self.model is None:
            raise RuntimeError(f"{self.kind} model is not trained")
        hist = np.asarray(history, dtype=np.float64)
        hist = hist[np.isfinite(hist)]
        if len(hist) < self.seq_length:
            raise ValueError(f"need {self.seq_length} hours of history to seed {self.kind}")

        window = ((hist[-self.seq_length:] - self.mean_) / self.std_).astype(np.float32).tolist()
        out: List[float] = []
        self.model.eval()
        with torch.no_grad():
            for _ in range(horizon):
                x = torch.tensor(window[-self.seq_length:], dtype=torch.float32).view(1, -1, 1)
                nxt = float(self.model(x).item())
                window.append(nxt)
                out.append(nxt * self.std_ + self.mean_)
        return out

    def residual_sigma(self, series: np.ndarray, sample_hours: int = 336) -> float:
        """One-step residual spread on the tail, in EUR/MWh — for p10/p90."""
        if not HAS_TORCH or self.model is None:
            return 0.0
        series = np.asarray(series, dtype=np.float64)
        series = series[np.isfinite(series)]
        if len(series) < self.seq_length + 24:
            return 0.0
        z = (series - self.mean_) / self.std_
        X, y = self._windows(z)
        X, y = X[-sample_hours:], y[-sample_hours:]
        with torch.no_grad():
            pred = self.model(torch.from_numpy(X).unsqueeze(-1)).squeeze(-1).numpy()
        return float(np.std(pred - y) * self.std_)
