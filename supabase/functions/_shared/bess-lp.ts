// Linear program for battery dispatch. Grid-side convention:
//   c_t = charge power drawn from the grid (kW)
//   d_t = discharge power delivered to the grid (kW)
// Efficiency is applied ONCE, in the energy balance — never in the objective
// as well, or charging looks cheaper than it is.
import solver from "https://esm.sh/javascript-lp-solver@0.4.24";

export type BessParams = {
  pMaxKw: number;
  usableKwh: number;
  socStartKwh: number;
  socMinKwh: number;
  socMaxKwh: number;
  socTerminalKwh: number;
  etaC: number;
  etaD: number;
  degEurPerMwh: number;
  maxCyclesPerDay: number;
  importLimitKw?: number | null;
  exportLimitKw?: number | null;
  dtHours: number;
};

export type Period = { ts: string; priceEurMwh: number };

export type PlanRow = {
  ts: string;
  priceEurMwh: number;
  chargeKw: number;
  dischargeKw: number;
  setpointKw: number;
  socKwh: number;
  socPct: number;
};

export type LpResult = {
  feasible: boolean;
  plan: PlanRow[];
  revenueEur: number;
  chargeCostEur: number;
  degradationEur: number;
  netEur: number;
  cyclesUsed: number;
  bindingConstraint: string;
};

export function optimiseBess(periods: Period[], p: BessParams): LpResult {
  const n = periods.length;
  const dt = p.dtHours;
  const cMax = Math.min(p.pMaxKw, p.importLimitKw ?? Infinity);
  const dMax = Math.min(p.pMaxKw, p.exportLimitKw ?? Infinity);
  const energyLimitKwh = p.maxCyclesPerDay * p.usableKwh * (n * dt) / 24;

  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<string, { min?: number; max?: number }> = {};

  for (let t = 0; t < n; t++) {
    const price = periods[t].priceEurMwh;
    const eMwh = dt / 1000; // kW → MWh over one period
    // charge variable
    const cv: Record<string, number> = {
      value: -(price * eMwh) - p.degEurPerMwh * eMwh,
      [`cmax${t}`]: 1,
      [`pmax${t}`]: 1,
    };
    const dv: Record<string, number> = {
      value: (price * eMwh) - p.degEurPerMwh * eMwh,
      [`dmax${t}`]: 1,
      [`pmax${t}`]: 1,
      cycle: dt / p.etaD,
    };
    for (let k = t; k < n; k++) {
      cv[`soc${k}`] = p.etaC * dt;
      dv[`soc${k}`] = -dt / p.etaD;
    }
    variables[`c${t}`] = cv;
    variables[`d${t}`] = dv;
    constraints[`cmax${t}`] = { max: cMax };
    constraints[`dmax${t}`] = { max: dMax };
    constraints[`pmax${t}`] = { max: p.pMaxKw };
    constraints[`soc${t}`] = {
      min: p.socMinKwh - p.socStartKwh,
      max: p.socMaxKwh - p.socStartKwh,
    };
  }
  // terminal SoC floor on the last cumulative balance
  constraints[`soc${n - 1}`] = {
    min: Math.max(p.socTerminalKwh, p.socMinKwh) - p.socStartKwh,
    max: p.socMaxKwh - p.socStartKwh,
  };
  constraints["cycle"] = { max: energyLimitKwh };

  const res = solver.Solve({ optimize: "value", opType: "max", variables, constraints }) as Record<string, number | boolean>;
  const feasible = Boolean(res.feasible);

  const plan: PlanRow[] = [];
  let soc = p.socStartKwh;
  let revenue = 0, chargeCost = 0, throughputMwh = 0, dischargedKwh = 0;
  for (let t = 0; t < n; t++) {
    const c = Math.max(0, Number(res[`c${t}`] ?? 0));
    const d = Math.max(0, Number(res[`d${t}`] ?? 0));
    soc += c * p.etaC * dt - (d * dt) / p.etaD;
    const eMwh = dt / 1000;
    revenue += d * eMwh * periods[t].priceEurMwh;
    chargeCost += c * eMwh * periods[t].priceEurMwh;
    throughputMwh += (c + d) * eMwh;
    dischargedKwh += (d * dt) / p.etaD;
    plan.push({
      ts: periods[t].ts,
      priceEurMwh: periods[t].priceEurMwh,
      chargeKw: +c.toFixed(3),
      dischargeKw: +d.toFixed(3),
      setpointKw: +(d - c).toFixed(3),
      socKwh: +soc.toFixed(3),
      socPct: p.usableKwh > 0 ? +((soc / p.usableKwh) * 100).toFixed(2) : 0,
    });
  }
  const degradation = throughputMwh * p.degEurPerMwh;
  const cyclesUsed = p.usableKwh > 0 ? dischargedKwh / p.usableKwh : 0;

  let binding = "spread_vs_degradation";
  if (!plan.some((r) => r.chargeKw > 0.01 || r.dischargeKw > 0.01)) {
    binding = "no_profitable_spread";
  } else if (dischargedKwh >= energyLimitKwh * 0.999) {
    binding = "cycle_limit";
  } else if (plan.some((r) => r.socKwh >= p.socMaxKwh - 0.01)) {
    binding = "soc_max";
  } else if (plan.some((r) => r.chargeKw >= cMax - 0.01 || r.dischargeKw >= dMax - 0.01)) {
    binding = "power_limit";
  } else if (plan[n - 1] && plan[n - 1].socKwh <= p.socTerminalKwh + 0.01) {
    binding = "terminal_soc";
  }

  return {
    feasible,
    plan,
    revenueEur: +revenue.toFixed(2),
    chargeCostEur: +chargeCost.toFixed(2),
    degradationEur: +degradation.toFixed(2),
    netEur: +(revenue - chargeCost - degradation).toFixed(2),
    cyclesUsed: +cyclesUsed.toFixed(3),
    bindingConstraint: binding,
  };
}