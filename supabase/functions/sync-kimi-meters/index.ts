// Sync meter reads from the VoltTrade Cloud gateway platform into
// public.meter_readings (settlement-grade cumulative registers) and
// public.consumption_readings (interval kWh for charts and billing).
//
// Mapping: metering_points.kimi_meter_id -> gateway device id.
//
// ── WHAT CHANGED AND WHY (audit P0-1/P0-3/§5) ────────────────────────────────
//
// 1. AUTH (P0-3). The previous version required an interactive user and then
//    filtered `metering_points.user_id = user.id`. cron.sql calls this with the
//    service-role key, which has no `sub` claim, so getUser() failed and every
//    scheduled run returned 401. Now handled by _shared/auth.ts: a service
//    caller syncs ALL linked metering points; a user caller syncs the same set
//    (RLS-visible staff scope), not just rows they personally created.
//
// 2. TRANSPORT (§5). The previous version opened a raw `postgres://` socket to
//    the gateway's TimescaleDB, which forced that port to be internet-exposed,
//    provided no revocable credential, and coupled billing to the gateway's
//    internal column names. It now calls the purpose-built, API-key
//    authenticated REST endpoint:
//        GET /api/v1/devices/:id/energy?from&to&bucketMin
//
// 3. CORRECTNESS (§5 — this one reached invoices). The old SQL derived interval
//    energy as `MAX(energy_import_kwh) - MIN(energy_import_kwh)` per bucket.
//    That is wrong across a counter rollover or a meter replacement: the
//    register resets to zero mid-bucket and MAX-MIN yields the whole pre-reset
//    reading as "consumption". The gateway's endpoint already implements
//    counter-reset-safe non-negative deltas and flags affected buckets as
//    `quality: "estimated"`. We now consume that and propagate the flag, so VEE
//    can quarantine estimated intervals instead of billing them silently.
//
// Secrets required:
//   GATEWAY_API_URL    e.g. https://cloud.volttrade.mk
//   GATEWAY_API_KEY    an etk_... key created in the gateway UI (Settings →
//                      API keys). Use a dedicated key named "erp-sync" with
//                      viewer role so it can be revoked without collateral.

import { authenticate, handler, json } from "../_shared/auth.ts";
import { fetchAllRows } from "../_shared/paginate.ts";

const MAX_RANGE_MINUTES = 31 * 24 * 60; // gateway rejects ranges over 31 days
const CHUNK = 500;

interface EnergyBucket {
  ts: string;
  importKwh: number | null;
  exportKwh: number | null;
  avgPowerKw: number | null;
  quality: "measured" | "estimated";
}

interface MeteringPoint {
  id: string;
  edu_code: string;
  kimi_meter_id: number;
}

Deno.serve(handler(async (req) => {
  const auth = await authenticate(req, {
    roles: ["admin", "management", "operations", "supply_manager"],
  });
  const admin = auth.admin;

  const apiUrl = (Deno.env.get("GATEWAY_API_URL") ?? "").replace(/\/+$/, "");
  const apiKey = Deno.env.get("GATEWAY_API_KEY") ?? "";
  if (!apiUrl || !apiKey) {
    return json(
      {
        ok: false,
        error:
          "GATEWAY_API_URL and GATEWAY_API_KEY must be configured. Create a viewer-role API key in the gateway UI (Settings → API keys).",
      },
      400,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* no body — use defaults */
  }
  const windowMinutes = clamp(Number(body.window_minutes) || 60, 5, MAX_RANGE_MINUTES);
  const bucketMinutes = clamp(Number(body.bucket_minutes) || 60, 15, 1440);

  // ── 1. Linked metering points ────────────────────────────────────────────
  // No user_id filter: the sync is an organisation-level job. Which points
  // exist is governed by the link (kimi_meter_id), not by who created the row.
  //
  // PAGINATION REPAIR 2026-09-01: this select had no bound, so it stopped at
  // the project's max_rows cap (1000). Past 1000 linked devices the sync would
  // have quietly polled a prefix of the fleet every 30 minutes and reported
  // success — the remaining meters would simply never produce readings, and
  // nothing downstream would flag it. fetchAllRows() walks .range() and throws
  // rather than truncating. The .order("id") is required: without a stable
  // sort, paged reads can repeat or skip rows between pages.
  const points = await fetchAllRows<MeteringPoint>(
    () => admin
      .from("metering_points")
      .select("id, edu_code, kimi_meter_id")
      .not("kimi_meter_id", "is", null)
      .order("id"),
    { label: "metering_points linked to a gateway device" },
  );

  if (points.length === 0) {
    return json({ ok: true, synced: 0, message: "No metering points linked to a gateway device." });
  }

  const to = new Date();
  const from = new Date(to.getTime() - windowMinutes * 60_000);

  let readingsUpserted = 0;
  let intervalsUpserted = 0;
  let estimatedBuckets = 0;
  const failures: Array<{ edu_code: string; error: string }> = [];

  // Sequential rather than Promise.all: the gateway is a single node and a
  // 200-device fleet firing concurrently would be a self-inflicted DoS.
  for (const mp of points) {
    try {
      const url =
        `${apiUrl}/api/v1/devices/${mp.kimi_meter_id}/energy` +
        `?from=${encodeURIComponent(from.toISOString())}` +
        `&to=${encodeURIComponent(to.toISOString())}` +
        `&bucketMin=${bucketMinutes}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        failures.push({
          edu_code: mp.edu_code,
          error: `gateway ${res.status}: ${detail.slice(0, 200)}`,
        });
        continue;
      }

      const payload = (await res.json()) as { buckets?: EnergyBucket[] };
      const buckets = payload.buckets ?? [];

      // ── Interval readings ────────────────────────────────────────────────
      // Buckets with no samples come back explicitly as null (the endpoint
      // never omits them) — skip those rather than writing zeros, which would
      // otherwise read as "confirmed zero consumption" downstream.
      const intervalRows = buckets
        .filter((b) => b.importKwh !== null && b.importKwh >= 0)
        .map((b) => {
          if (b.quality === "estimated") estimatedBuckets++;
          return {
            metering_point_id: mp.id,
            reading_at: b.ts,
            actual_mwh: (b.importKwh as number) / 1000,
            source: "PRIVATE_SMART",
            is_estimated: b.quality === "estimated",
            quality: b.quality,
          };
        });

      for (let i = 0; i < intervalRows.length; i += CHUNK) {
        const slice = intervalRows.slice(i, i + CHUNK);
        const { error } = await admin
          .from("consumption_readings")
          .upsert(slice, { onConflict: "metering_point_id,reading_at" });
        if (error) throw error;
        intervalsUpserted += slice.length;
      }

      // ── Cumulative register ──────────────────────────────────────────────
      // /latest gives the true cumulative counter. Deriving it by summing
      // buckets would drift, so read it directly.
      const latestRes = await fetch(`${apiUrl}/api/v1/devices/${mp.kimi_meter_id}/latest`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (latestRes.ok) {
        const latest = (await latestRes.json()) as {
          ts: string | null;
          values?: Record<string, number | null>;
        };
        if (latest.ts && latest.values) {
          const imp = latest.values.energyImportKwh ?? latest.values.energy_import_kwh;
          const exp = latest.values.energyExportKwh ?? latest.values.energy_export_kwh;
          if (imp !== undefined && imp !== null) {
            const { error } = await admin.from("meter_readings").upsert(
              {
                metering_point_id: mp.id,
                reading_at: latest.ts,
                import_kwh: imp,
                export_kwh: exp ?? 0,
                source: "api",
                validation_status: "pending",
                created_by: auth.userId, // null for scheduled runs — intended
                notes: "Auto-synced from VoltTrade Cloud /api/v1 — awaiting VEE",
              },
              { onConflict: "metering_point_id,reading_at" },
            );
            if (error) throw error;
            readingsUpserted++;
          }
        }
      }
    } catch (err) {
      failures.push({
        edu_code: mp.edu_code,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = {
    ok: failures.length === 0,
    caller: auth.kind,
    devices: points.length,
    readings_synced: readingsUpserted,
    intervals_synced: intervalsUpserted,
    estimated_buckets: estimatedBuckets,
    window_minutes: windowMinutes,
    bucket_minutes: bucketMinutes,
    failures,
  };

  // Feed /admin/sync-health rather than failing silently at 03:00.
  await admin
    .from("external_api_log")
    .insert({
      provider: "volttrade-cloud",
      endpoint: "/api/v1/devices/:id/energy",
      status: failures.length === 0 ? 200 : 207,
      detail: result as unknown as Record<string, unknown>,
    })
    .then(() => undefined, () => undefined); // never let logging break the sync

  // Partial failure is a 207-shaped condition; return 200 with the detail so
  // pg_cron does not retry-storm, but surface `ok: false` for the UI.
  return json(result);
}));

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
