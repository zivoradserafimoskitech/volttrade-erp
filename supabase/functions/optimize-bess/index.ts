// optimize-bess — day-ahead / intraday battery dispatch by linear programming.
//
// Refuses to run rather than guess:
//   · starting SoC must come from asset_telemetry_latest, < 15 min old
//   · every period in the horizon must have a market price
//   · degradation_eur_per_mwh must be set on the asset
// Writes asset_dispatch_schedules rows with mode = 'arbitrage', replacing only
// previously PLANNED arbitrage rows in the future horizon. 'sent' rows and
// manual rows are never touched.
import { authenticate, handler, json } from "../_shared/auth.ts";
import { optimiseBess, type Period } from "../_shared/bess-lp.ts";

const SOC_MAX_AGE_MS = 15 * 60_000;
const PAGE = 1000;

Deno.serve(handler(async (req: Request) => {
  const auth = await authenticate(req, { roles: ["admin", "operations", "trader"] });
  const admin = auth.admin;

  let body: {
    asset_id?: string; horizon_hours?: number; from?: string;
    backtest?: boolean; start_soc_pct?: number; dry_run?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* no body */ }

  if (!body.asset_id) return json({ ok: false, error: "asset_id is required" }, 400);
  const horizonHours = Math.min(Math.max(Number(body.horizon_hours ?? 24), 1), 48);
  const backtest = Boolean(body.backtest);

  const { data: asset, error: aErr } = await admin
    .from("assets")
    .select("id, asset_code, asset_type, nameplate_power_kw, nameplate_energy_kwh, usable_energy_kwh, charge_efficiency, discharge_efficiency, soc_min_pct, soc_max_pct, soc_terminal_pct, degradation_eur_per_mwh, max_cycles_per_day, grid_import_limit_kw, grid_export_limit_kw, organization_id")
    .eq("id", body.asset_id).maybeSingle();
  if (aErr) throw aErr;
  if (!asset) return json({ ok: false, error: "Asset not found" }, 404);
  if (asset.degradation_eur_per_mwh == null) {
    return json({ ok: false, error: "degradation_eur_per_mwh is not set on this asset. Set it (capex / (usable MWh × warranty cycles × 2)) before optimising." }, 400);
  }
  const pMax = Number(asset.nameplate_power_kw ?? 0);
  const usable = Number(asset.usable_energy_kwh ?? asset.nameplate_energy_kwh ?? 0);
  if (pMax <= 0 || usable <= 0) {
    return json({ ok: false, error: "Asset needs nameplate power and usable energy before optimising." }, 400);
  }

  // ── horizon ──
  const from = body.from ? new Date(body.from) : new Date();
  from.setUTCMinutes(0, 0, 0);
  const horizonStart = new Date(from.getTime() + (body.from ? 0 : 3600_000));
  const horizonEnd = new Date(horizonStart.getTime() + horizonHours * 3600_000);

  // ── prices (hourly, must be complete) ──
  const prices: Array<{ delivery_at: string; price_eur_mwh: number }> = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await admin
      .from("market_prices")
      .select("delivery_at, price_eur_mwh")
      .gte("delivery_at", horizonStart.toISOString())
      .lt("delivery_at", horizonEnd.toISOString())
      .order("delivery_at")
      .range(off, off + PAGE - 1);
    if (error) throw error;
    prices.push(...((data ?? []) as Array<{ delivery_at: string; price_eur_mwh: number }>));
    if ((data ?? []).length < PAGE) break;
  }
  const priceByHour = new Map<number, number>();
  for (const p of prices) priceByHour.set(new Date(p.delivery_at).setUTCMinutes(0, 0, 0), Number(p.price_eur_mwh));

  const periods: Period[] = [];
  const missing: string[] = [];
  for (let i = 0; i < horizonHours; i++) {
    const t = new Date(horizonStart.getTime() + i * 3600_000);
    const v = priceByHour.get(t.getTime());
    if (v == null) missing.push(t.toISOString());
    else periods.push({ ts: t.toISOString(), priceEurMwh: v });
  }
  if (missing.length) {
    return json({ ok: false, error: `No market price for ${missing.length} of ${horizonHours} periods — sync prices first, the optimizer will not assume zero.`, missing }, 400);
  }

  // ── starting SoC: measured, fresh ──
  let startSocPct: number;
  let socAt: string | null = null;
  if (backtest && body.start_soc_pct != null) {
    startSocPct = Number(body.start_soc_pct);
  } else {
    const { data: tel } = await admin
      .from("asset_telemetry_latest").select("soc_pct, ts").eq("asset_id", asset.id).maybeSingle();
    if (!tel || tel.soc_pct == null) {
      return json({ ok: false, error: "No state of charge telemetry for this asset — no plan produced." }, 409);
    }
    const age = Date.now() - new Date(tel.ts).getTime();
    if (age > SOC_MAX_AGE_MS) {
      return json({ ok: false, error: `State of charge is ${Math.round(age / 60000)} min old (limit 15 min) — no plan produced.` }, 409);
    }
    startSocPct = Number(tel.soc_pct);
    socAt = tel.ts;
  }

  const result = optimiseBess(periods, {
    pMaxKw: pMax,
    usableKwh: usable,
    socStartKwh: (startSocPct / 100) * usable,
    socMinKwh: (Number(asset.soc_min_pct ?? 10) / 100) * usable,
    socMaxKwh: (Number(asset.soc_max_pct ?? 95) / 100) * usable,
    socTerminalKwh: (Number(asset.soc_terminal_pct ?? 50) / 100) * usable,
    etaC: Number(asset.charge_efficiency ?? 0.938),
    etaD: Number(asset.discharge_efficiency ?? 0.938),
    degEurPerMwh: Number(asset.degradation_eur_per_mwh),
    maxCyclesPerDay: Number(asset.max_cycles_per_day ?? 1.5),
    importLimitKw: asset.grid_import_limit_kw,
    exportLimitKw: asset.grid_export_limit_kw,
    dtHours: 1,
  });

  if (!result.feasible) {
    return json({ ok: false, error: "The problem is infeasible with these limits (check SoC window and terminal SoC)." }, 409);
  }

  // ── persist the run (the "why") ──
  const { data: run } = await admin.from("bess_optimizer_runs").insert({
    asset_id: asset.id,
    horizon_start: horizonStart.toISOString(),
    horizon_end: horizonEnd.toISOString(),
    periods: periods.length,
    start_soc_kwh: +((startSocPct / 100) * usable).toFixed(3),
    start_soc_at: socAt,
    expected_revenue_eur: result.revenueEur - result.chargeCostEur,
    degradation_cost_eur: result.degradationEur,
    net_value_eur: result.netEur,
    cycles_used: result.cyclesUsed,
    binding_constraint: result.bindingConstraint,
    mode: backtest ? "backtest" : "arbitrage",
    backtest,
    prices: periods,
    plan: result.plan,
    created_by: auth.userId,
  }).select("id").maybeSingle();

  let written = 0;
  if (!backtest && !body.dry_run) {
    // Replace only planned arbitrage rows in the future horizon.
    const cutoff = new Date(Math.max(Date.now(), horizonStart.getTime())).toISOString();
    await admin.from("asset_dispatch_schedules").delete()
      .eq("asset_id", asset.id).eq("mode", "arbitrage").eq("status", "planned")
      .gte("ts_from", cutoff).lt("ts_from", horizonEnd.toISOString());

    // Never overwrite a manual override for the same period.
    const { data: manual } = await admin.from("asset_dispatch_schedules")
      .select("ts_from").eq("asset_id", asset.id).eq("mode", "manual")
      .gte("ts_from", horizonStart.toISOString()).lt("ts_from", horizonEnd.toISOString());
    const manualTs = new Set(((manual ?? []) as Array<{ ts_from: string }>).map((m) => new Date(m.ts_from).getTime()));

    const rows = result.plan
      .filter((r) => new Date(r.ts).getTime() >= new Date(cutoff).getTime() && !manualTs.has(new Date(r.ts).getTime()))
      .map((r) => ({
        asset_id: asset.id,
        organization_id: asset.organization_id,
        ts_from: r.ts,
        ts_to: new Date(new Date(r.ts).getTime() + 3600_000).toISOString(),
        setpoint_kw: r.setpointKw,
        mode: "arbitrage",
        status: "planned",
        notes: `LP run ${run?.id ?? ""} · price ${r.priceEurMwh.toFixed(2)} €/MWh · SoC ${r.socPct.toFixed(0)}%`,
        created_by: auth.userId,
      }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("asset_dispatch_schedules").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
    written = rows.length;
  }

  await admin.from("external_api_log").insert({
    provider: "internal", endpoint: "optimize-bess", status: 200,
    detail: {
      asset: asset.asset_code, periods: periods.length, net_eur: result.netEur,
      cycles: result.cyclesUsed, binding: result.bindingConstraint, rows: written, backtest,
    },
  });

  return json({
    ok: true,
    run_id: run?.id ?? null,
    asset: { id: asset.id, code: asset.asset_code, usable_kwh: usable, p_max_kw: pMax },
    horizon: { start: horizonStart.toISOString(), end: horizonEnd.toISOString(), periods: periods.length },
    start_soc_pct: startSocPct,
    start_soc_at: socAt,
    gross_revenue_eur: result.revenueEur,
    charge_cost_eur: result.chargeCostEur,
    degradation_eur: result.degradationEur,
    net_eur: result.netEur,
    cycles_used: result.cyclesUsed,
    binding_constraint: result.bindingConstraint,
    dispatch_rows_written: written,
    plan: result.plan,
  });
}));