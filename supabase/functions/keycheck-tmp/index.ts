Deno.serve(async (req) => {
  const enc = new TextEncoder();
  const h = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))).slice(0,4).map(b=>b.toString(16).padStart(2,"0")).join("");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const tok = (req.headers.get("Authorization") ?? "").slice(7).trim();
  return new Response(JSON.stringify({
    env_len: k.length, env_h: await h(k), env_prefix: k.slice(0,3),
    tok_len: tok.length, tok_h: await h(tok), match: k === tok,
    has_secret_keys: !!Deno.env.get("SUPABASE_SECRET_KEYS"),
  }), { headers: { "Content-Type": "application/json" } });
});
