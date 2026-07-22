// Public lead capture from the Vatra landing page. No auth (verify_jwt=false).
// Writes a lead via service role, then sends a confirmation email. SMS is
// wired but disabled until an MK SMS provider is configured (SMS_PROVIDER_URL).
//
// Body: { contact_name, contact_email, contact_phone, consumer_type, company_name? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const name = String(b.contact_name ?? "").trim();
    const email = String(b.contact_email ?? "").trim().toLowerCase();
    const phone = String(b.contact_phone ?? "").trim();
    const type = String(b.consumer_type ?? "").trim(); // household | business
    const company = String(b.company_name ?? "").trim();

    if (!name || (!email && !phone)) {
      return json({ ok: false, error: "Внесете име и барем еден контакт (е-пошта или телефон)." });
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ ok: false, error: "Неважечка е-пошта." });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Basic dedupe: same email or phone still in early stages within 30 days
    if (email || phone) {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data: existing } = await admin.from("leads")
        .select("id").gte("created_at", since)
        .or([email ? `contact_email.eq.${email}` : "", phone ? `contact_phone.eq.${phone}` : ""].filter(Boolean).join(","))
        .in("stage", ["lead", "qualified", "quote", "contract_sent"]).limit(1);
      if (existing?.length) {
        return json({ ok: true, duplicate: true, message: "Веќе имаме ваше барање — наскоро ќе ве контактираме." });
      }
    }

    const { data: lead, error } = await admin.from("leads").insert({
      user_id: "00000000-0000-0000-0000-000000000000", // system/anonymous origin
      company_name: company || name,           // company_name is NOT NULL; use name for individuals
      contact_name: name,
      contact_email: email || null,
      contact_phone: phone || null,
      consumer_type: type || null,
      country: "MK",
      stage: "lead",
      source: "web",
    }).select("id").single();
    if (error) return json({ ok: false, error: error.message });

    // ── Confirmation email (Resend if configured; otherwise skip gracefully) ──
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromAddr = Deno.env.get("VATRA_FROM_EMAIL") || "Vatra <onboarding@resend.dev>";
    let emailSent = false;
    if (resendKey && email) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromAddr, to: [email], subject: "Vatra — го примивме вашето барање",
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto">
              <h2 style="color:#FF6B2C">Благодариме, ${name}!</h2>
              <p>Го примивме вашето барање за приклучување кон <b>Vatra</b>.</p>
              <p>Наш претставник ќе ве контактира наскоро за да ги дооформиме деталите и да ви ја понудиме најдобрата тарифа.</p>
              <p style="color:#888;font-size:13px">Ако не сте го поднеле ова барање, игнорирајте ја пораката.</p>
            </div>`,
          }),
        });
        emailSent = r.ok;
      } catch { /* email is best-effort */ }
    }

    // ── SMS (wired, disabled until provider configured) ──
    const smsUrl = Deno.env.get("SMS_PROVIDER_URL");
    const smsKey = Deno.env.get("SMS_PROVIDER_KEY");
    let smsSent = false;
    if (smsUrl && smsKey && phone) {
      try {
        const r = await fetch(smsUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${smsKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ to: phone, text: `Vatra: Го примивме вашето барање, ${name}. Наскоро ќе ве контактираме.` }),
        });
        smsSent = r.ok;
      } catch { /* best-effort */ }
    }

    return json({ ok: true, lead_id: lead.id, email_sent: emailSent, sms_sent: smsSent,
      message: "Барањето е испратено. Наш претставник ќе ве контактира наскоро." });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
});
