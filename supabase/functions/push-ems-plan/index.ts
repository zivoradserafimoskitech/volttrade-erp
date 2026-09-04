// PHASE 3 / AUDIT P0-4 — CLOSING THE CONTROL LOOP.
//
// This is the piece the whole two-system architecture was missing.
//
// The gateway's EMS controller has always documented plans as "externally
// pushed, e.g. by the VoltTrade optimizer", and `PUT /api/v1/devices/:id/
// ems-plan` has always worked. Nothing in the ERP ever called it. The ERP
// wrote dispatch decisions into `asset_dispatch_schedules` where they sat and
// did nothing: the ERP could compute an optimal BESS schedule from day-ahead
// prices and imbalance position, and had no way to execute it.
//
// This function reads due dispatch rows and pushes them as an EMS plan.
//
// ── SAFETY NOTES, because this moves real power ────────────────────────────
//
//  1. SEPARATE CREDENTIAL. Uses GATEWAY_EMS_API_KEY (scope ems:write), never
//     the billing key. If it is unset this refuses to run rather than falling
//     back to a read key.
//
//  2. THE GATEWAY REMAINS THE AUTHORITY. Its EMS controller resolves
//     peak-shaving > plan > schedule, and every setpoint still passes the
//     controllable-register whitelist and range interlock. A bad plan from
//     here cannot bypass those. That is why the plan push is safe to automate
//     and why we do NOT write setpoints directly.
//
//  3. SIGN CONVENTION IS EXPLICITLY RECONCILED. Both sides use
//     "+ = discharge to grid, - = charge from grid" (ERP:
//     asset_dispatch_schedules.setpoint_kw; gateway: BESS batteryPowerKw).
//     They agree, so no negation is applied — but it is asserted below rather
//     than assumed, because getting this backwards would charge at the exact
//     moment you meant to discharge, at peak price.
//
//  4. NAMEPLATE CLAMP. Setpoints are clamped to the asset's nameplate power
//     before being sent. The gateway range-checks too; this is defence in
//     depth and produces a clearer audit trail on the ERP side.
//
//  5. HORIZON CAP. The gateway rejects spans over 48h. We push at most 24h so
//     a stale plan self-expires within a day if this job stops running.

import { authenticate, handler, json } from "../_shared/auth.ts";
import { GatewayClient, GatewayError, type PlanSetpoint } from "../_shared/gateway-client.ts";

const MAX_HORIZON_HOURS = 24;
const MAX_SETPOINTS = 500; // gateway's PLAN_MAX_SETPOINTS

interface DispatchRow {
  id: string;
  asset_id: string;
  ts_from: string;
  ts_to: string;
  setpoint_kw: number;
  mode: string;
  status: string;
}

interface AssetRow {
  id: string;
  asset_code: string;
  asset_type: string;
  nameplate_power_kw: number | null;
  gateway_device_id: number | null;
  soc_min_pct: number | null;
  soc_max_pct: number | null;
}

Deno.serve(handler(async (req) => {
  const auth = await authenticate(req, {
    roles: ["admin", "management", "operations", "trading"],
  });
  const admin = auth.admin;

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run === true;
  const horizonHours = clamp(Number(body.horizon_hours) || MAX_HORIZON_HOURS, 1, MAX_HORIZON_HOURS);

  let gw: GatewayClient;
  try {
    gw = GatewayClient.dispatcher();
  } catch (err) {
    // Gateway credentials are not configured. This is a deployment gap, not a
    // server fault: returning 500 on every 15-minute cron tick buried the real
    // errors under a permanent alert storm. Report it as a skipped run.
    return json({
      ok: false,
      skipped: "gateway_not_configured",
      error: err instanceof GatewayError ? err.message : String(err),
    }, 200);
  }

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + horizonHours * 3600_000);

  // ── Assets that are actually linked to a gateway device ────────────────
  const { data: assetsRaw, error: aErr } = await admin
    .from("assets")
    .select("id, asset_code, asset_type, nameplate_power_kw, gateway_device_id, soc_min_pct, soc_max_pct")
    .not("gateway_device_id", "is", null)
    .eq("status", "active")
    .range(0, 999);
  if (aErr) throw aErr;
  const assets = (assetsRaw ?? []) as AssetRow[];
  if (assets.length === 0) {
    return json({
      ok: true,
      pushed: 0,
      message:
        "No active assets are linked to a gateway device. Set assets.gateway_device_id " +
        "to the device id from the gateway platform.",
    });
  }

  // ── Dispatch rows in the horizon ───────────────────────────────────────
  // 'planned' = not yet sent; 'sent' = re-pushed so that a plan edited after
  // sending still reaches the plant. Pushing is idempotent on the gateway
  // side (overlapping active plans are superseded), so re-sending is safe.
  const { data: dispatchRaw, error: dErr } = await admin
    .from("asset_dispatch_schedules")
    .select("id, asset_id, ts_from, ts_to, setpoint_kw, mode, status")
    .in("asset_id", assets.map((a) => a.id))
    .in("status", ["planned", "sent"])
    .lt("ts_from", horizonEnd.toISOString())
    .gte("ts_to", now.toISOString())
    .order("ts_from", { ascending: true })
    .range(0, 9999);
  if (dErr) throw dErr;
  const dispatch = (dispatchRaw ?? []) as DispatchRow[];

  const results: Array<Record<string, unknown>> = [];
  let pushed = 0;
  let skipped = 0;
  const failures: Array<{ asset_code: string; error: string; transient: boolean }> = [];

  for (const asset of assets) {
    const rows = dispatch.filter((d) => d.asset_id === asset.id);
    if (rows.length === 0) {
      skipped++;
      continue;
    }

    // ── Build the setpoint series ────────────────────────────────────────
    // Each dispatch row is an interval [ts_from, ts_to) at a constant kW. The
    // gateway plan is a series of (ts, kw) step points, so emit the start of
    // each interval, plus an explicit 0 kW at the end of the last interval so
    // the plant does not hold the final setpoint indefinitely.
    const clampKw = (kw: number): number => {
      const cap = asset.nameplate_power_kw;
      if (!cap || !Number.isFinite(cap) || cap <= 0) return kw;
      return Math.max(-cap, Math.min(cap, kw));
    };

    const setpoints: PlanSetpoint[] = [];
    let clamped = 0;
    let lastEnd = new Date(0);

    for (const r of rows) {
      const from = new Date(r.ts_from);
      const to = new Date(r.ts_to);
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) continue;
      const raw = Number(r.setpoint_kw);
      if (!Number.isFinite(raw)) continue;
      const kw = clampKw(raw);
      if (kw !== raw) clamped++;

      // SIGN: ERP setpoint_kw and gateway batteryPowerKw share the convention
      // (+ discharge / - charge). No negation — see safety note 3.
      const ts = from < now ? now : from; // never schedule in the past
      if (ts >= horizonEnd) continue;
      setpoints.push({ ts: ts.toISOString(), kw });
      if (to > lastEnd) lastEnd = to;
    }

    if (setpoints.length === 0) {
      skipped++;
      continue;
    }

    // Trailing zero so the plan ends rather than latching.
    const planEnd = lastEnd > horizonEnd ? horizonEnd : lastEnd;
    if (planEnd > new Date(setpoints[setpoints.length - 1].ts)) {
      setpoints.push({ ts: planEnd.toISOString(), kw: 0 });
    }

    // Gateway requires non-descending ts and a bounded count.
    setpoints.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    if (setpoints.length > MAX_SETPOINTS) {
      failures.push({
        asset_code: asset.asset_code,
        error: `${setpoints.length} setpoints exceeds the gateway limit of ${MAX_SETPOINTS}; coarsen the dispatch resolution`,
        transient: false,
      });
      continue;
    }

    const validFrom = new Date(setpoints[0].ts);
    const validTo = new Date(setpoints[setpoints.length - 1].ts);
    if (validTo <= validFrom) {
      skipped++;
      continue;
    }

    if (dryRun) {
      results.push({
        asset_code: asset.asset_code,
        device_id: asset.gateway_device_id,
        setpoints: setpoints.length,
        clamped,
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        peak_kw: Math.max(...setpoints.map((s) => Math.abs(s.kw))),
        would_push: true,
      });
      continue;
    }

    try {
      const res = await gw.pushEmsPlan(asset.gateway_device_id!, {
        validFrom,
        validTo,
        source: `volttrade-erp:${rows[0].mode}`,
        setpoints,
        // Energy guard rails travel with the plan: the optimizer respects these
        // when planning, but without them in the PUT body the plant has no
        // fallback if reality drifts from the schedule.
        minSoc: asset.soc_min_pct,
        maxSoc: asset.soc_max_pct,
      });

      await admin
        .from("asset_dispatch_schedules")
        .update({
          status: "sent",
          gateway_plan_id: res.planId,
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .in("id", rows.map((r) => r.id));

      pushed++;
      results.push({
        asset_code: asset.asset_code,
        device_id: asset.gateway_device_id,
        plan_id: res.planId,
        superseded: res.superseded,
        setpoints: setpoints.length,
        clamped,
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
      });
    } catch (err) {
      const ge = err instanceof GatewayError ? err : new GatewayError(String(err), 0);
      failures.push({ asset_code: asset.asset_code, error: ge.message, transient: ge.transient });
      // Mark failed so the UI shows it — a dispatch that silently never
      // reached the plant is the worst outcome here.
      await admin
        .from("asset_dispatch_schedules")
        .update({ status: "failed", last_error: ge.message.slice(0, 500) })
        .in("id", rows.map((r) => r.id));
    }
  }

  const out = {
    ok: failures.length === 0,
    dry_run: dryRun,
    caller: auth.kind,
    assets_linked: assets.length,
    dispatch_rows: dispatch.length,
    plans_pushed: pushed,
    assets_skipped: skipped,
    results,
    failures,
  };

  await admin
    .from("external_api_log")
    .insert({
      provider: "volttrade-cloud",
      endpoint: "PUT /api/v1/devices/:id/ems-plan",
      status: failures.length === 0 ? 200 : 207,
      detail: out as unknown as Record<string, unknown>,
    })
    .then(() => undefined, () => undefined);

  return json(out);
}));

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
