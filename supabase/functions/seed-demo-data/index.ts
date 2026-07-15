// Seed realistic Hungarian/EU demo data for the signed-in user
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth) return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve user
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  // Admin-only: seeding demo data can pollute production; require the admin role.
  const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });

  try {
    // 1) Clients
    const clientPayload = [
      { user_id: user.id, company_name: "Magyar Acél Zrt.", tax_id: "HU12345678", contact_name: "Kovács Péter", contact_email: "p.kovacs@magyaracel.hu", contact_phone: "+36 1 234 5678", contract_type: "market", margin_eur_mwh: 4.50 },
      { user_id: user.id, company_name: "Budapest Logistics Kft.", tax_id: "HU23456789", contact_name: "Nagy Éva", contact_email: "eva.nagy@bplog.hu", contact_phone: "+36 1 345 6789", contract_type: "fixed", fixed_price_eur_mwh: 118.50, margin_eur_mwh: 3.80 },
      { user_id: user.id, company_name: "Danube Chemicals SA", tax_id: "HU34567890", contact_name: "Szabó János", contact_email: "j.szabo@danube-chem.eu", contact_phone: "+36 1 456 7890", contract_type: "market", margin_eur_mwh: 5.20 },
      { user_id: user.id, company_name: "Pannon Foods Kft.", tax_id: "HU45678901", contact_name: "Tóth Anna", contact_email: "anna.toth@pannonfoods.hu", contact_phone: "+36 1 567 8901", contract_type: "fixed", fixed_price_eur_mwh: 124.00, margin_eur_mwh: 3.20 },
      { user_id: user.id, company_name: "Visegrád Cement Zrt.", tax_id: "HU56789012", contact_name: "Horváth Béla", contact_email: "b.horvath@vcement.hu", contact_phone: "+36 1 678 9012", contract_type: "market", margin_eur_mwh: 4.00 },
    ];
    const { data: insertedClients, error: ce } = await supabase.from("clients").insert(clientPayload).select();
    if (ce) throw ce;

    // 2) Metering points (EDUs) — Hungarian-style codes
    const edus: any[] = [];
    insertedClients!.forEach((c, i) => {
      const n = 1 + (i % 3);
      for (let j = 0; j < n; j++) {
        edus.push({
          client_id: c.id,
          edu_code: `HU000120F${10+i}U${(100000 + i*1000 + j).toString().padStart(6, "0")}`,
          address: ["Budapest, Váci út 1.", "Debrecen, Ipari park 12.", "Győr, Audi tér 3.", "Szeged, Etele út 8."][((i+j)%4)],
          voltage_level: ["MV","HV","LV"][j%3],
          annual_consumption_mwh: 1500 + Math.round(Math.random()*8000),
        });
      }
    });
    const { data: insertedEdus, error: ee } = await supabase.from("metering_points").insert(edus).select();
    if (ee) throw ee;

    // 3) Market prices — last 7 days hourly, HUPX-like
    const now = new Date();
    now.setMinutes(0,0,0);
    const prices: any[] = [];
    for (let h = 7*24 - 1; h >= 0; h--) {
      const t = new Date(now.getTime() - h*3600*1000);
      const hour = t.getUTCHours();
      // base diurnal pattern (peak in evening)
      const base = 95 + 35 * Math.sin((hour - 6) * Math.PI / 12);
      const noise = (Math.random() - 0.5) * 18;
      prices.push({ delivery_at: t.toISOString(), price_eur_mwh: +(base + noise).toFixed(2) });
    }
    // Upsert (unique on delivery_at) — ignore conflicts
    await supabase.from("market_prices").upsert(prices, { onConflict: "delivery_at", ignoreDuplicates: true });

    // 4) Consumption readings — last 7 days hourly per EDU
    const readings: any[] = [];
    insertedEdus!.forEach((m: any) => {
      const ann = Number(m.annual_consumption_mwh ?? 3000);
      const baseMwh = ann / 8760; // average MWh per hour
      for (let h = 7*24 - 1; h >= 0; h--) {
        const t = new Date(now.getTime() - h*3600*1000);
        const hour = t.getUTCHours();
        const day = t.getUTCDay();
        const weekday = day >= 1 && day <= 5 ? 1 : 0.6;
        const shape = 0.6 + 0.7 * Math.max(0, Math.sin((hour - 6) * Math.PI / 12));
        const fc = baseMwh * shape * weekday;
        const actual = fc * (0.92 + Math.random() * 0.16);
        readings.push({
          metering_point_id: m.id,
          reading_at: t.toISOString(),
          forecast_mwh: +fc.toFixed(4),
          actual_mwh: +actual.toFixed(4),
        });
      }
    });
    // chunk insert (avoid huge body)
    for (let i = 0; i < readings.length; i += 500) {
      const chunk = readings.slice(i, i + 500);
      const { error } = await supabase.from("consumption_readings").upsert(chunk, { onConflict: "metering_point_id,reading_at", ignoreDuplicates: true });
      if (error) throw error;
    }

    // 5) A few nominations
    const noms: any[] = [];
    for (let d = 0; d < 5; d++) {
      const date = new Date(now.getTime() - d*24*3600*1000).toISOString().slice(0,10);
      noms.push({ user_id: user.id, trade_date: date, side: "buy",  counterparty: "HUPX DAM", volume_mwh: 120 + Math.round(Math.random()*60), price_eur_mwh: +(95 + Math.random()*20).toFixed(2), balancing_cost_eur: +(Math.random()*250).toFixed(2) });
      noms.push({ user_id: user.id, trade_date: date, side: "sell", counterparty: "OTC Bilateral", volume_mwh: 80 + Math.round(Math.random()*60), price_eur_mwh: +(110 + Math.random()*20).toFixed(2), balancing_cost_eur: +(Math.random()*150).toFixed(2) });
    }
    await supabase.from("nominations").insert(noms);

    return new Response(JSON.stringify({ ok: true, clients: insertedClients!.length, edus: insertedEdus!.length, prices: prices.length, readings: readings.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});