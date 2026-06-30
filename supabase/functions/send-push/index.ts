// send-push: enqueues a notification row and (when Firebase service account is
// configured) sends a FCM HTTP v1 push to all device tokens for the target users.
// Falls back to log-only mode if FIREBASE_SERVICE_ACCOUNT_JSON is missing — the
// row still lands in public.notifications so the portal shows it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type Body = {
  user_ids?: string[];
  topic: string;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string>;
};

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SA_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
const FB_PROJECT = Deno.env.get("FIREBASE_PROJECT_ID");

async function getAccessToken(sa: any): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${enc(header)}.${enc(claims)}`;
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = `${unsigned}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

async function sendFcm(accessToken: string, project: string, token: string, msg: Body) {
  const payload = {
    message: {
      token,
      notification: { title: msg.title, body: msg.body },
      data: { url: msg.url || "/portal", topic: msg.topic, ...(msg.data || {}) },
      webpush: { fcm_options: { link: msg.url || "/portal" } },
    },
  };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Require authenticated admin/operations caller before sending notifications
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const userClient = createClient(PROJECT_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const { data: allowed } = await userClient.rpc("has_any_role", { _user_id: u.user.id, _roles: ["admin", "operations", "management"] });
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const supabase = createClient(PROJECT_URL, SERVICE_KEY);
    const body = (await req.json()) as Body;
    if (!body?.topic || !body?.title || !body?.body) {
      return new Response(JSON.stringify({ error: "topic, title, body required" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // Resolve target users — defaults to ALL users that opted into the topic.
    let userIds = body.user_ids;
    if (!userIds || userIds.length === 0) {
      const col = ["billing", "savings", "ev", "alerts", "outage", "cheapest_slot"].includes(body.topic) ? body.topic : "alerts";
      const { data } = await supabase.from("notification_preferences").select("user_id").eq(col, true);
      userIds = (data || []).map((r: any) => r.user_id);
    }
    if (userIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: "no targets" }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    // Insert history rows (one per user)
    await supabase.from("notifications").insert(
      userIds.map((uid) => ({ user_id: uid, topic: body.topic, title: body.title, body: body.body, url: body.url, data: body.data || null, delivered: false }))
    );

    // If FCM not configured yet, stop here in log-only mode.
    if (!SA_JSON || !FB_PROJECT) {
      return new Response(JSON.stringify({ ok: true, mode: "log-only", users: userIds.length }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const sa = JSON.parse(SA_JSON);
    const accessToken = await getAccessToken(sa);
    const { data: tokens } = await supabase.from("device_tokens").select("token,user_id").in("user_id", userIds);
    const results = await Promise.all((tokens || []).map((t: any) => sendFcm(accessToken, FB_PROJECT, t.token, body)));
    const sent = results.filter((r) => r.ok).length;

    // Clean up dead tokens
    const dead = (tokens || []).filter((_t: any, i: number) => !results[i].ok && /UNREGISTERED|INVALID_ARGUMENT/.test(results[i].body || "")).map((t: any) => t.token);
    if (dead.length) await supabase.from("device_tokens").delete().in("token", dead);

    if (sent > 0) await supabase.from("notifications").update({ delivered: true }).in("user_id", userIds).eq("title", body.title);

    return new Response(JSON.stringify({ ok: true, mode: "fcm", users: userIds.length, sent, failed: results.length - sent }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});