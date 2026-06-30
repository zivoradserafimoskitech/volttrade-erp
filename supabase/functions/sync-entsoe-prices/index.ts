import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// ENTSO-E bidding zone EICs
const ZONES: Record<string, string> = {
  HU: "10YHU-MAVIR----U",
  MK: "10YMK-MEPSO----8",
  DE_LU: "10Y1001A1001A82H",
  AT: "10YAT-APG------L",
  RO: "10YRO-TEL------P",
  RS: "10YCS-SERBIATSOV",
};

function ymdHm(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

// Naive XML parser for ENTSO-E Publication_MarketDocument day-ahead prices.
// Extracts <TimeSeries> -> <Period> with <timeInterval><start>/<end> and <Point><position>/<price.amount>.
function parsePrices(xml: string): { delivery_at: string; price_eur_mwh: number }[] {
  const out: { delivery_at: string; price_eur_mwh: number }[] = [];
  const periodRe = /<Period>([\s\S]*?)<\/Period>/g;
  let m: RegExpExecArray | null;
  while ((m = periodRe.exec(xml))) {
    const body = m[1];
    const start = body.match(/<timeInterval>[\s\S]*?<start>([^<]+)<\/start>/)?.[1];
    const resolution = body.match(/<resolution>([^<]+)<\/resolution>/)?.[1] ?? "PT60M";
    if (!start) continue;
    const stepMin = resolution.includes("15") ? 15 : resolution.includes("30") ? 30 : 60;
    const startDate = new Date(start);
    const pointRe = /<Point>\s*<position>(\d+)<\/position>\s*<price\.amount>([-\d.]+)<\/price\.amount>\s*<\/Point>/g;
    let p: RegExpExecArray | null;
    while ((p = pointRe.exec(body))) {
      const pos = parseInt(p[1], 10);
      const price = parseFloat(p[2]);
      const t = new Date(startDate.getTime() + (pos - 1) * stepMin * 60_000);
      out.push({ delivery_at: t.toISOString(), price_eur_mwh: price });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // AuthN + AuthZ: require a signed-in admin/operations user, OR a shared cron secret header
    const cronSecret = Deno.env.get("CRON_SHARED_SECRET");
    const providedCron = req.headers.get("x-cron-secret");
    const isCron = !!cronSecret && providedCron === cronSecret;
    if (!isCron) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: allowed } = await userClient.rpc("has_any_role", { _user_id: userData.user.id, _roles: ["admin", "operations", "management"] });
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const token = Deno.env.get("ENTSOE_API_TOKEN");
    if (!token) {
      return new Response(
        JSON.stringify({ error: "ENTSOE_API_TOKEN not configured. Get a free token from transparency.entsoe.eu and add it as a secret." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let zone = "HU";
    let days = 2; // default: yesterday + today + tomorrow window
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.zone && ZONES[body.zone]) zone = body.zone;
        if (typeof body?.days === "number" && body.days > 0 && body.days <= 7) days = body.days;
      } catch (_) { /* ignore */ }
    } else {
      const url = new URL(req.url);
      const z = url.searchParams.get("zone");
      if (z && ZONES[z]) zone = z;
    }

    const eic = ZONES[zone];
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 3600_000);
    const end = new Date(now.getTime() + days * 24 * 3600_000);

    const params = new URLSearchParams({
      securityToken: token,
      documentType: "A44", // day-ahead prices
      in_Domain: eic,
      out_Domain: eic,
      periodStart: ymdHm(start),
      periodEnd: ymdHm(end),
    });
    const apiUrl = `https://web-api.tp.entsoe.eu/api?${params.toString()}`;

    const res = await fetch(apiUrl);
    const xml = await res.text();
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `ENTSO-E ${res.status}`, detail: xml.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prices = parsePrices(xml);
    if (prices.length === 0) {
      return new Response(
        JSON.stringify({ inserted: 0, zone, note: "No prices in response window" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // De-dupe: delete existing rows in window for this zone-agnostic price set, then insert.
    // (market_prices has no zone column — we treat the table as single-zone HU baseline.)
    const startIso = prices[0].delivery_at;
    const endIso = prices[prices.length - 1].delivery_at;
    await supabase.from("market_prices")
      .delete()
      .gte("delivery_at", startIso)
      .lte("delivery_at", endIso);

    const { error } = await supabase.from("market_prices").insert(prices);
    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ inserted: prices.length, zone, from: startIso, to: endIso }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e as Error).message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});