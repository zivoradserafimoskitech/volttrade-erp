// Phase 3 (audit §5, item 18): surface gateway alarms in the ERP.
//
// The gateway has a full alarm engine — rules evaluated per sample, severity,
// acknowledgement, escalation after ALARM_ESCALATE_MIN — and exposes
// GET /api/v1/alarms. The ERP never read it, so an operator watching the ERP
// had no idea a battery was faulted or a gateway had gone offline. Commercial
// and operational views of the same fleet were disconnected.
//
// This mirrors alarms into public.gateway_alarms, joined to assets and
// metering points where the device link is known, so the ERP can show
// "this client's site has an active alarm" next to the commercial record.
//
// The ERP is a MIRROR, not the source of truth: acknowledgement and resolution
// happen in the gateway (that is where the operator with plant context works).
// We deliberately do not write back — two systems both claiming authority over
// alarm state is how you get an alarm that is acknowledged in one place and
// screaming in the other.

import { authenticate, handler, json } from "../_shared/auth.ts";
import { GatewayClient, GatewayError } from "../_shared/gateway-client.ts";

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

  // "all" so that resolutions propagate — fetching only active alarms would
  // leave rows stuck active in the ERP forever once the gateway cleared them.
  const alarms = await gw.alarms("all");

  // Resolve device -> asset / metering point where a link exists.
  const [{ data: assets }, { data: mps }] = await Promise.all([
    admin.from("assets").select("id, gateway_device_id").not("gateway_device_id", "is", null),
    admin.from("metering_points").select("id, kimi_meter_id").not("kimi_meter_id", "is", null),
  ]);
  const assetByDevice = new Map<number, string>(
    (assets ?? []).map((a: { id: string; gateway_device_id: number }) => [a.gateway_device_id, a.id]),
  );
  const mpByDevice = new Map<number, string>(
    (mps ?? []).map((m: { id: string; kimi_meter_id: number }) => [m.kimi_meter_id, m.id]),
  );

  const rows = alarms.map((a) => ({
    gateway_alarm_id: a.id,
    device_id: a.meterId,
    gateway_id: a.gatewayId,
    asset_id: a.meterId != null ? assetByDevice.get(a.meterId) ?? null : null,
    metering_point_id: a.meterId != null ? mpByDevice.get(a.meterId) ?? null : null,
    metric: a.metric,
    value: a.value,
    threshold: a.threshold,
    severity: a.severity,
    message: a.message,
    status: a.status,
    triggered_at: a.triggeredAt,
    acknowledged_at: a.acknowledgedAt,
    resolved_at: a.resolvedAt,
    synced_at: new Date().toISOString(),
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { error } = await admin
      .from("gateway_alarms")
      .upsert(slice, { onConflict: "gateway_alarm_id" });
    if (error) throw error;
    upserted += slice.length;
  }

  const active = rows.filter((r) => r.status === "active");
  const out = {
    ok: true,
    caller: auth.kind,
    total: rows.length,
    upserted,
    active: active.length,
    critical: active.filter((r) => r.severity === "critical").length,
    unlinked: rows.filter((r) => !r.asset_id && !r.metering_point_id).length,
  };

  await admin
    .from("external_api_log")
    .insert({
      provider: "volttrade-cloud",
      endpoint: "/api/v1/alarms",
      status: 200,
      detail: out as unknown as Record<string, unknown>,
    })
    .then(() => undefined, () => undefined);

  return json(out);
}));
