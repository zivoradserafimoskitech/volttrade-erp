// VEE — Validation, Estimation, Editing for meter data.
// 1) Register reads (meter_readings, cumulative): pending → validated / flagged
//    Rules: register decrease (rollback/meter swap) → flagged;
//           implied average power > 3× connection power → flagged.
// 2) Interval reads (consumption_readings): negative or spiking values → flagged
//    Spike = actual > max(5 × same-hour median of prior 14 days, physical max).
// 3) Gap estimation: missing hourly buckets in the window are filled with the
//    average of the same hour over the prior 7 days (min 3 samples),
//    inserted with quality='estimated'.
// Invoke: supabase.functions.invoke("validate-readings", { body: { window_hours: 72 } })
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const windowHours = Number(body.window_hours ?? 72);
    const sinceISO = new Date(Date.now() - windowHours * 3600_000).toISOString();

    // Connection power per metering point (physical plausibility limit)
    const { data: cps } = await admin.from("metering_points").select("id, connected_power_kw");
    const powerKw = new Map<string, number>();
    (cps ?? []).forEach((c: any) => { powerKw.set(c.id, Number(c.connected_power_kw || 0)); });
    const limitKw = (mp: string) => powerKw.get(mp) || 100; // fallback if unclassified

    // ── 1. Register validation ────────────────────────────────────
    const { data: pend } = await admin.from("meter_readings")
      .select("id, metering_point_id, reading_at, import_kwh")
      .eq("validation_status", "pending")
      .order("metering_point_id").order("reading_at")
      .limit(5000);
    let regValidated = 0, regFlagged = 0;
    const lastAccepted = new Map<string, { at: number; kwh: number }>();
    // seed with last validated read per mp before the pending batch
    const mpSet = [...new Set((pend ?? []).map((r: any) => r.metering_point_id))];
    for (const mp of mpSet) {
      const { data: prev } = await admin.from("meter_readings")
        .select("reading_at, import_kwh").eq("metering_point_id", mp)
        .eq("validation_status", "validated").order("reading_at", { ascending: false }).limit(1);
      if (prev?.[0]) lastAccepted.set(mp, { at: new Date(prev[0].reading_at).getTime(), kwh: Number(prev[0].import_kwh) });
    }
    const toStatus: { id: string; status: string; note: string | null }[] = [];
    for (const r of (pend ?? []) as any[]) {
      const prev = lastAccepted.get(r.metering_point_id);
      const kwh = Number(r.import_kwh || 0);
      const at = new Date(r.reading_at).getTime();
      let status = "validated", note: string | null = null;
      if (prev) {
        const dK = kwh - prev.kwh;
        const dH = Math.max((at - prev.at) / 3600_000, 0.25);
        if (dK < 0) { status = "flagged"; note = `Register decreased by ${(-dK).toFixed(1)} kWh — rollback or meter swap`; }
        else if (dK / dH > 3 * limitKw(r.metering_point_id)) { status = "flagged"; note = `Implied ${(dK / dH).toFixed(0)} kW average > 3× connection power`; }
      }
      if (status === "validated") { lastAccepted.set(r.metering_point_id, { at, kwh }); regValidated++; } else regFlagged++;
      toStatus.push({ id: r.id, status, note });
    }
    for (const u of toStatus) {
      await admin.from("meter_readings").update({ validation_status: u.status, ...(u.note ? { notes: u.note } : {}) }).eq("id", u.id);
    }

    // ── 2. Interval validation ────────────────────────────────────
    const { data: iv } = await admin.from("consumption_readings")
      .select("id, metering_point_id, reading_at, actual_mwh, quality")
      .gte("reading_at", sinceISO).eq("quality", "measured")
      .order("metering_point_id").order("reading_at").limit(20000);
    // history for medians: prior 14 days
    const histSince = new Date(Date.now() - (windowHours + 14 * 24) * 3600_000).toISOString();
    const { data: hist } = await admin.from("consumption_readings")
      .select("metering_point_id, reading_at, actual_mwh")
      .gte("reading_at", histSince).lt("reading_at", sinceISO)
      .neq("quality", "flagged").limit(50000);
    const histKey = (mp: string, h: number) => `${mp}|${h}`;
    const buckets = new Map<string, number[]>();
    (hist ?? []).forEach((r: any) => {
      const k = histKey(r.metering_point_id, new Date(r.reading_at).getUTCHours());
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(Number(r.actual_mwh || 0));
    });
    const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    let ivFlagged = 0;
    for (const r of (iv ?? []) as any[]) {
      const v = Number(r.actual_mwh || 0);
      const med = median(buckets.get(histKey(r.metering_point_id, new Date(r.reading_at).getUTCHours())) ?? []);
      const physMaxMwh = (limitKw(r.metering_point_id) * 1.2) / 1000; // per hourly bucket
      let bad: string | null = null;
      if (v < 0) bad = "negative";
      else if (med > 0 && v > 5 * med && v > physMaxMwh) bad = `spike ${v.toFixed(3)} MWh vs median ${med.toFixed(3)}`;
      else if (med === 0 && v > physMaxMwh) bad = `exceeds physical max ${physMaxMwh.toFixed(3)} MWh`;
      if (bad) { await admin.from("consumption_readings").update({ quality: "flagged" }).eq("id", r.id); ivFlagged++; }
    }

    // ── 3. Gap estimation (hourly) ────────────────────────────────
    let estimated = 0;
    const byMp = new Map<string, Set<number>>();
    (iv ?? []).forEach((r: any) => {
      if (!byMp.has(r.metering_point_id)) byMp.set(r.metering_point_id, new Set());
      byMp.get(r.metering_point_id)!.add(new Date(r.reading_at).setUTCMinutes(0, 0, 0));
    });
    for (const [mp, seen] of byMp) {
      const hs = [...seen].sort((a, b) => a - b);
      if (hs.length < 2) continue;
      for (let t = hs[0] + 3600_000; t < hs[hs.length - 1]; t += 3600_000) {
        if (seen.has(t)) continue;
        const hour = new Date(t).getUTCHours();
        const samples = buckets.get(histKey(mp, hour)) ?? [];
        if (samples.length < 3) continue;
        const est = samples.reduce((s, x) => s + x, 0) / samples.length;
        const { error } = await admin.from("consumption_readings").upsert([{
          metering_point_id: mp, reading_at: new Date(t).toISOString(),
          actual_mwh: est, source: "PRIVATE_SMART", is_estimated: true, quality: "estimated",
        }] as any, { onConflict: "metering_point_id,reading_at", ignoreDuplicates: true });
        if (!error) estimated++;
      }
    }

    return json({ ok: true, registers_validated: regValidated, registers_flagged: regFlagged, intervals_flagged: ivFlagged, gaps_estimated: estimated, window_hours: windowHours });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
});
