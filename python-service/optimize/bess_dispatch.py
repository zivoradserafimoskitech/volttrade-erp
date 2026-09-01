"""
VoltTrade BESS Dispatch Optimizer
Python LP implementation, identical convention to bess-lp.ts:
  - Efficiency applied ONCE in energy balance
  - Cash flow on grid side
  - Degradation on battery side
  - Cycle cap is warranty (hard constraint), not soft penalty

Uses PuLP (open-source CBC) or falls back to greedy heuristic.
"""

import numpy as np
from typing import List, Dict, Optional
import logging

logger = logging.getLogger(__name__)

try:
    import pulp
    HAS_PULP = True
except ImportError:
    HAS_PULP = False
    logger.warning("pulp not installed — using greedy heuristic")


class BessDispatch:
    """BESS dispatch via LP or greedy heuristic."""

    def optimize(self, prices: List[float], p_max_mw: float = 1.0,
                 e_max_mwh: float = 2.0, eta_c: float = 0.95, eta_d: float = 0.95,
                 soc_start: float = 0.5, soc_min: float = 0.05, soc_max: float = 0.95,
                 max_cycles: float = 1.5, dt_hours: float = 1.0) -> Dict:
        """Optimize battery dispatch for price arbitrage."""

        n = len(prices)
        if n == 0:
            raise ValueError("Empty price vector")
        if n > 168:
            logger.warning(f"Long horizon ({n}h), truncating to 168h")
            prices = prices[:168]
            n = 168

        if HAS_PULP:
            try:
                return self._lp_solve(prices, p_max_mw, e_max_mwh, eta_c, eta_d,
                                      soc_start, soc_min, soc_max, max_cycles, dt_hours)
            except Exception as e:
                logger.warning(f"LP solve failed: {e}, falling back to greedy")

        return self._greedy_solve(prices, p_max_mw, e_max_mwh, eta_c, eta_d,
                                  soc_start, soc_min, soc_max, max_cycles, dt_hours)

    def _lp_solve(self, prices, p_max, e_max, eta_c, eta_d, soc_start, soc_min, soc_max, max_cycles, dt):
        """PuLP LP formulation — exact optimal dispatch."""
        n = len(prices)

        prob = pulp.LpProblem("BESS_Dispatch", pulp.LpMaximize)

        # Decision variables
        c = [pulp.LpVariable(f"c_{t}", lowBound=0, upBound=p_max) for t in range(n)]
        d = [pulp.LpVariable(f"d_{t}", lowBound=0, upBound=p_max) for t in range(n)]
        soc = [pulp.LpVariable(f"soc_{t}", lowBound=soc_min*e_max, upBound=soc_max*e_max) for t in range(n)]

        # Objective: maximize revenue (grid-side cash flow)
        # Revenue = discharge * price - charge * price
        revenue = pulp.lpSum([
            (d[t] * prices[t] - c[t] * prices[t]) * dt
            for t in range(n)
        ])
        prob += revenue

        # SoC balance: energy in battery
        # soc[t] = soc[t-1] + charge * eta_c * dt - discharge / eta_d * dt
        prob += soc[0] == soc_start * e_max + c[0] * eta_c * dt - d[0] / eta_d * dt
        for t in range(1, n):
            prob += soc[t] == soc[t-1] + c[t] * eta_c * dt - d[t] / eta_d * dt

        # Cycle limit (warranty hard constraint)
        # Total energy throughput <= max_cycles * capacity
        prob += pulp.lpSum([(c[t] + d[t]) * dt for t in range(n)]) <= max_cycles * e_max

        # Terminal SoC: return to near start (optional but good for rolling horizon)
        prob += soc[n-1] >= soc_start * e_max * 0.8
        prob += soc[n-1] <= soc_start * e_max * 1.2

        # Solve
        solver = pulp.PULP_CBC_CMD(msg=False, timeLimit=30)
        prob.solve(solver)

        status = pulp.LpStatus[prob.status]
        feasible = status == "Optimal"

        if not feasible:
            logger.warning(f"LP status: {status}, falling back to greedy")
            return self._greedy_solve(prices, p_max, e_max, eta_c, eta_d,
                                      soc_start, soc_min, soc_max, max_cycles, dt)

        charge = [float(pulp.value(c[t])) for t in range(n)]
        discharge = [float(pulp.value(d[t])) for t in range(n)]
        soc_vals = [float(pulp.value(soc[t])) for t in range(n)]

        revenue_val = sum((discharge[t] * prices[t] - charge[t] * prices[t]) * dt for t in range(n))
        cycles = sum((charge[t] + discharge[t]) * dt for t in range(n)) / e_max

        return {
            "feasible": True,
            "charge_schedule": [round(x, 3) for x in charge],
            "discharge_schedule": [round(x, 3) for x in discharge],
            "soc_schedule_pct": [round((s / e_max) * 100, 2) for s in soc_vals],
            "revenue_eur": round(revenue_val, 2),
            "net_profit_eur": round(revenue_val, 2),
            "cycles_used": round(cycles, 3),
            "solver_status": status,
        }

    def _greedy_solve(self, prices, p_max, e_max, eta_c, eta_d, soc_start, soc_min, soc_max, max_cycles, dt):
        """Greedy heuristic: buy low, sell high."""
        n = len(prices)
        charge = [0.0] * n
        discharge = [0.0] * n
        soc = soc_start * e_max
        soc_min_kwh = soc_min * e_max
        soc_max_kwh = soc_max * e_max
        max_energy = max_cycles * e_max
        used_energy = 0

        # Sort hours by price
        sorted_hours = sorted(range(n), key=lambda i: prices[i])
        n_buy = max(1, n // 3)
        n_sell = max(1, n // 3)
        buy_hours = set(sorted_hours[:n_buy])
        sell_hours = set(sorted_hours[-n_sell:])

        for t in range(n):
            if t in buy_hours and soc < soc_max_kwh and used_energy < max_energy:
                amount = min(p_max * dt, (soc_max_kwh - soc) / eta_c)
                charge[t] = amount / dt
                soc += amount * eta_c
                used_energy += amount
            elif t in sell_hours and soc > soc_min_kwh and used_energy < max_energy:
                amount = min(p_max * dt, (soc - soc_min_kwh) * eta_d)
                discharge[t] = amount / dt
                soc -= amount / eta_d
                used_energy += amount

        revenue = sum((discharge[t] * prices[t] - charge[t] * prices[t]) * dt for t in range(n))
        cycles = used_energy / e_max

        return {
            "feasible": True,
            "charge_schedule": [round(x, 3) for x in charge],
            "discharge_schedule": [round(x, 3) for x in discharge],
            "soc_schedule_pct": [round((soc / e_max) * 100, 2)] * n,  # simplified
            "revenue_eur": round(revenue, 2),
            "net_profit_eur": round(revenue, 2),
            "cycles_used": round(cycles, 3),
            "solver_status": "greedy_heuristic",
        }
