// Asset telemetry sync — BESS / PV / inverter.
//
// ── PHASE 3: INFLUXDB RETIRED (audit §5) ────────────────────────────────────
//
// This function used to query a SEPARATE InfluxDB instance. That meant the
// same physical battery was monitored twice — once by the gateway platform
// (which already ingests BESS and inverter telemetry via SunSpec profiles over
// MQTT/Modbus) and once by an independent Influx pipeline — with two schemas,
// two credentials, no reconciliation, and a standing "which number is right?"
// question.
//
// It now reads the gateway's own store through
//   GET /api/v1/devices/:id/telemetry?keys=...
// which was added in Phase 3 precisely because /latest and /energy could not
// serve a state-of-charge trend.
//
// Mapping: assets.gateway_device_id -> gateway device id.
// (`assets.external_ref` was the InfluxDB tag and is now unused for this path.)
//
// Auth: service-role (pg_cron) or staff JWT — see _shared/auth.ts. The old
// version had the same auth bug as sync-kimi-meters, so its scheduled runs had
// been returning 401 too.

import { authenticate, handler, json } from "../_shared/auth.ts";
import { GatewayClient, GatewayError } from "../_shared/gateway-client.ts";

// Canonical gateway metric keys (contracts/devices.ts) mapped onto the ERP's
// asset_telemetry columns. Requested per device type so we do not ask a PV
// inverter for state of charge.
const KEYS_BY_TYPE: Record<string, string[]> = {
  bess: [
    "socPercent",
    "sohPercent",
    "batteryPowerKw",
    "dischargeEnergyTotalKwh",
    "chargeEnergyTotalKwh",
    "cellTempMaxC",
    "bmsStatusCode",
    "faultCode",
  ],
  inverter: ["activePowerKw", "energyTotalKwh", "energyTodayKwh", "statusCode", "faultCode"],
  meter: ["activePowerKw", "energyImportKwh", "energyExportKwh"],
  weather: ["irradianceWm2", "ambientTempC"],
};

interface AssetRow {
  id: string;
  asset_code: string;
  asset_type: string;
  gateway_device_id: number | null;
  user_id: string | null;
}

Deno.serve(handler(async (req) => {
  const auth = await authenticate(req, {
    roles: ["admin", "management", "operations", "trading"],
  });
  const admin = auth.admin;

  let gw: GatewayClient;
  try {
    gw = GatewayClient.reader();
  } catch (err) {
    return json({ ok: false, error: err instanceof GatewayError ? err.message : String(err) }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const windowMinutes = clamp(Number(body.window_minutes) || 120, 15, 44_640);
  const bucketMinutes = clamp(Number(body.bucket_minutes) || 15, 1, 1440);

  const { data: assetsRaw, error: aErr } = await admin
    .from("assets")
    .select("id, asset_code, asset_type, gateway_device_id, user_id")
    .not("gateway_device_id", "is", null)
    .eq("status", "active");
  if (aErr) throw aErr;
  const assets = (assetsRaw ?? []) as AssetRow[];

  if (assets.length === 0) {
    return json({
      ok: true,
      synced: 0,
      message:
        "No active assets linked to a gateway device. Set assets.gateway_device_id " +
        "(Assets → edit → Gateway device).",
    });
  }

  const to = new Date();
  const from = new Date(to.getTime() - windowMinutes * 60_000);

  let rowsUpserted = 0;
  let latestUpdated = 0;
  const failures: Array<{ asset_code: string; error: string }> = [];

  for (const asset of assets) {
    try {
      const keys = KEYS_BY_TYPE[asset.asset_type] ?? KEYS_BY_TYPE.meter;
      const buckets = await gw.telemetry(asset.gateway_device_id!, from, to, keys, bucketMinutes);

      // Empty buckets come back explicitly with null values — skip rather than
      // writing zeros, which downstream would read as a confirmed measurement.
      const rows = buckets
        .filter((b) => b.samples > 0)
        .map((b) => {
          const v = b.values;
          const isBess = asset.asset_type === "bess";
          return {
            user_id: asset.user_id,
            asset_id: asset.id,
            ts: b.ts,
            // Signed power: + discharge/generation, - charge/consumption.
            // Matches the gateway's batteryPowerKw convention exactly.
            power_kw: isBess ? v.batteryPowerKw ?? null : v.activePowerKw ?? null,
            soc_pct: v.socPercent ?? null,
            energy_kwh: isBess ? v.dischargeEnergyTotalKwh ?? null : v.energyTotalKwh ?? null,
            pv_generation_kwh: asset.asset_type === "inverter" ? v.energyTodayKwh ?? null : null,
            pv_irradiance_w_m2: v.irradianceWm2 ?? null,
            status: statusOf(v),
            alarm_code: v.faultCode != null && v.faultCode !== 0 ? String(v.faultCode) : null,
            source: "volttrade-cloud",
          };
        });

      for (let i = 0; i < rows.length; i += 500) {
        const slice = rows.slice(i, i + 500);
        const { error } = await admin
          .from("asset_telemetry")
          .upsert(slice, { onConflict: "asset_id,ts" });
        if (error) throw error;
        rowsUpserted += slice.length;
      }

      // Latest snapshot from /latest — the true instantaneous value rather
      // than the mean of the final bucket.
      const latest = await gw.latest(asset.gateway_device_id!);
      if (latest.ts && latest.values) {
        const v = latest.values as Record<string, number>;
        const isBess = asset.asset_type === "bess";
        const { error } = await admin.from("asset_telemetry_latest").upsert(
          {
            asset_id: asset.id,
            user_id: asset.user_id,
            ts: latest.ts,
            power_kw: isBess ? v.batteryPowerKw ?? null : v.activePowerKw ?? null,
            soc_pct: v.socPercent ?? null,
            pv_generation_kwh: v.energyTodayKwh ?? null,
            grid_kw: v.activePowerKw ?? null,
            load_kw: null,
            status: statusOf(v),
            alarm_code: v.faultCode != null && v.faultCode !== 0 ? String(v.faultCode) : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "asset_id" },
        );
        if (error) throw error;
        latestUpdated++;
      }
    } catch (err) {
      failures.push({
        asset_code: asset.asset_code,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const out = {
    ok: failures.length === 0,
    caller: auth.kind,
    source: "volttrade-cloud",
    assets: assets.length,
    rows_synced: rowsUpserted,
    latest_updated: latestUpdated,
    window_minutes: windowMinutes,
    bucket_minutes: bucketMinutes,
    failures,
  };

  await admin
    .from("external_api_log")
    .insert({
      provider: "volttrade-cloud",
      endpoint: "/api/v1/devices/:id/telemetry",
      status: failures.length === 0 ? 200 : 207,
      detail: out as unknown as Record<string, unknown>,
    })
    .then(() => undefined, () => undefined);

  return json(out);
}));

function statusOf(v: Record<string, number | null>): string | null {
  if (v.faultCode != null && v.faultCode !== 0) return "fault";
  if (v.bmsStatusCode != null) return `bms:${v.bmsStatusCode}`;
  if (v.statusCode != null) return `inv:${v.statusCode}`;
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
