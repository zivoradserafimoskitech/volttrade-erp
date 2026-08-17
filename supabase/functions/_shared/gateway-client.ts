// Phase 3: one client for every call into the VoltTrade Cloud gateway.
//
// WHY THIS EXISTS
// ---------------
// Phase 1 rewrote the meter sync to use the gateway's REST API. Phase 3 adds
// three more integrations (EMS plan push, asset telemetry, alarms). Without a
// shared client each one would re-implement base URL handling, auth, timeouts,
// retries and error shapes — which is exactly how the five edge functions all
// ended up with the same auth bug that broke every scheduled sync.
//
// KEYS AND SCOPES
// ---------------
// The gateway now enforces per-key scopes. Use SEPARATE keys:
//
//   GATEWAY_API_KEY       scopes: sites:read, energy:read, telemetry:read
//                         Billing and telemetry reads. Cannot command plant.
//
//   GATEWAY_EMS_API_KEY   scopes: sites:read, telemetry:read, ems:read, ems:write
//                         Dispatch only. Can charge/discharge a battery.
//
// They are separate so that the credential sitting in the billing sync cannot
// move a megawatt. If GATEWAY_EMS_API_KEY is unset the dispatch push refuses to
// run rather than falling back to the read key.

export interface GatewayDevice {
  id: number;
  name: string;
  model: string | null;
  deviceType: "meter" | "inverter" | "bess" | "weather";
  siteId: number | null;
  gatewayId: number | null;
  status: string;
  effectiveSiteId: number | null;
  gatewayUid?: string | null;
}

export interface EnergyBucket {
  ts: string;
  importKwh: number | null;
  exportKwh: number | null;
  avgPowerKw: number | null;
  quality: "measured" | "estimated";
}

export interface MetricBucket {
  ts: string;
  values: Record<string, number | null>;
  samples: number;
}

export interface GatewayAlarm {
  id: number;
  meterId: number | null;
  gatewayId: number | null;
  metric: string;
  value: number | null;
  threshold: number | null;
  severity: string;
  message: string | null;
  status: "active" | "acknowledged" | "resolved";
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface PlanSetpoint {
  ts: string;
  kw: number;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
  /** Worth retrying on the next cron tick rather than alerting a human. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export class GatewayClient {
  private readonly base: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    private readonly timeoutMs = 30_000,
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Build a client for read-only integrations (billing, telemetry, alarms).
   */
  static reader(): GatewayClient {
    const url = Deno.env.get("GATEWAY_API_URL");
    const key = Deno.env.get("GATEWAY_API_KEY");
    if (!url || !key) {
      throw new GatewayError(
        "GATEWAY_API_URL and GATEWAY_API_KEY must be set. Create a key in the " +
          "gateway UI with scopes: sites:read, energy:read, telemetry:read.",
        500,
      );
    }
    return new GatewayClient(key, url);
  }

  /**
   * Build a client that may command plant. Deliberately a separate factory and
   * a separate credential — this must never silently fall back to the read key.
   */
  static dispatcher(): GatewayClient {
    const url = Deno.env.get("GATEWAY_API_URL");
    const key = Deno.env.get("GATEWAY_EMS_API_KEY");
    if (!url || !key) {
      throw new GatewayError(
        "GATEWAY_EMS_API_KEY must be set to push dispatch. Create a SEPARATE " +
          "key in the gateway UI with the ems:write scope. Do not reuse the " +
          "billing key — that key intentionally cannot command plant.",
        500,
      );
    }
    return new GatewayClient(key, url);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/v1${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Network failure / timeout — status 0 marks it transient.
      throw new GatewayError(
        `Gateway unreachable: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    }

    if (!res.ok) {
      let body: unknown;
      const text = await res.text().catch(() => "");
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      const detail =
        body && typeof body === "object" && "error" in (body as Record<string, unknown>)
          ? String((body as Record<string, unknown>).error)
          : text.slice(0, 200);
      // A 403 here almost always means the key lacks a scope, so say so.
      const hint =
        res.status === 403
          ? " (check the API key's scopes in the gateway UI)"
          : res.status === 401
            ? " (key revoked or expired)"
            : "";
      throw new GatewayError(`${res.status} ${detail}${hint}`, res.status, body);
    }
    return (await res.json()) as T;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async devices(): Promise<GatewayDevice[]> {
    const r = await this.request<{ devices: GatewayDevice[] }>("/devices");
    return r.devices ?? [];
  }

  async latest(deviceId: number): Promise<{ ts: string | null; values: Record<string, number> }> {
    return await this.request(`/devices/${deviceId}/latest`);
  }

  async energy(
    deviceId: number,
    from: Date,
    to: Date,
    bucketMin: number,
  ): Promise<EnergyBucket[]> {
    const q = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMin: String(bucketMin),
    });
    const r = await this.request<{ buckets: EnergyBucket[] }>(
      `/devices/${deviceId}/energy?${q}`,
    );
    return r.buckets ?? [];
  }

  /** Phase 3: multi-metric history — the InfluxDB replacement. */
  async telemetry(
    deviceId: number,
    from: Date,
    to: Date,
    keys: string[],
    bucketMin: number,
  ): Promise<MetricBucket[]> {
    const q = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMin: String(bucketMin),
      keys: keys.join(","),
    });
    const r = await this.request<{ buckets: MetricBucket[] }>(
      `/devices/${deviceId}/telemetry?${q}`,
    );
    return r.buckets ?? [];
  }

  async alarms(status: "active" | "acknowledged" | "resolved" | "all" = "active"): Promise<GatewayAlarm[]> {
    const r = await this.request<{ alarms: GatewayAlarm[] }>(`/alarms?status=${status}`);
    return r.alarms ?? [];
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Push an EMS plan. Requires the ems:write scope.
   *
   * Gateway-side contract (api/rest/v1.ts):
   *   - span <= 48h, 1..PLAN_MAX_SETPOINTS entries
   *   - setpoints sorted non-descending by ts, all within [validFrom, validTo]
   *   - overlapping active plans for the device are SUPERSEDED, not merged
   *
   * The gateway's EMS controller resolves priority as
   * peak-shaving > plan > schedule, so a pushed plan does NOT override a
   * safety-driven peak-shaving action. That is deliberate and correct.
   */
  async pushEmsPlan(
    deviceId: number,
    plan: {
      validFrom: Date;
      validTo: Date;
      source: string;
      setpoints: PlanSetpoint[];
      /** State-of-charge guard rails (%), enforced plant-side if the plan drifts. */
      minSoc?: number | null;
      maxSoc?: number | null;
    },
  ): Promise<{ planId: number; status: string; superseded: number }> {
    return await this.request(`/devices/${deviceId}/ems-plan`, {
      method: "PUT",
      body: JSON.stringify({
        validFrom: plan.validFrom.toISOString(),
        validTo: plan.validTo.toISOString(),
        source: plan.source.slice(0, 64),
        setpoints: plan.setpoints,
        ...(plan.minSoc != null && Number.isFinite(plan.minSoc) ? { minSoc: plan.minSoc } : {}),
        ...(plan.maxSoc != null && Number.isFinite(plan.maxSoc) ? { maxSoc: plan.maxSoc } : {}),
      }),
    });
  }

  async getEmsPlan(deviceId: number): Promise<unknown> {
    const r = await this.request<{ plan: unknown }>(`/devices/${deviceId}/ems-plan`);
    return r.plan;
  }
}
