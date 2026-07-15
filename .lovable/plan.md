# Take Volttrade ERP to production

Goal: live, hardened production deployment on a custom domain, using a separate Lovable Cloud environment starting with clean data.

I'll drive this end-to-end and only stop for the few inputs only you can provide (domain, first admin email, slug).

## Phase 1 — Harden the current build (no user input needed)

Run in this order, block on failures:

1. **Security scan** (`security--run_security_scan`) + **Supabase linter** (`supabase--linter`) + **dependency scan** (`code--dependency_scan`). Resolve every critical/high; ignore only with written rationale saved to security memory.
2. **RLS review** on every public table: `clients`, `metering_points`, `consumption_readings`, `market_prices`, `nominations`, `user_roles`, `consumer_applications`, plus the `kyc-docs` storage bucket. Confirm portal users are scoped via `current_portal_client_id()` and staff mutations go through `has_role` / `has_any_role`. Confirm each table has explicit `GRANT`s matching its policies.
3. **Auth config** via `supabase--configure_auth`:
   - Disable anonymous sign-ups.
   - Require email confirmation.
   - Enable Password HIBP (leaked-password) check.
   - Verify Google provider is configured; add production redirect URLs once the domain is known.
4. **Edge functions**: lock `seed-demo-data` behind `admin` role (currently open to any authed user); re-verify `admin-invite-user`, `admin-invite-consumer`, `decide-consumer-application`, `link-consumer-pod`, `import-dso-reads`, `submit-schedule` role checks.
5. **SEO / metadata**: update `index.html` `<title>` and `<meta name="description">` to Volttrade ERP + matching `og:` / `twitter:` tags (currently generic).

## Phase 2 — Separate production Cloud environment

Lovable Cloud has Test and Live backends. We'll use **Live** so real customer data never mixes with dev data.

1. Enable the Live environment.
2. Replay every migration against Live so schema, roles, functions, triggers, and the `kyc-docs` bucket match.
3. Re-add runtime secrets on Live (`LOVABLE_API_KEY` and any integration keys). Supabase env vars auto-populate.
4. Deploy all edge functions to Live.
5. Do **not** run `seed-demo-data` on Live — production starts empty.
6. Invite the first production admin and assign the `admin` role in `user_roles` (needs your email).

## Phase 3 — Publish + custom domain

1. Publish to the Lovable URL (slug of your choice).
2. Connect the custom domain in Project Settings → Domains (auto-setup where possible; otherwise A `@` and `www` → `185.158.133.1` + TXT `_lovable` verification; enable proxy mode if Cloudflare).
3. Wait for DNS propagation; Lovable auto-provisions SSL.
4. Add the production domain to Google OAuth redirect URLs.
5. Optional: hide the "Edit with Lovable" badge (Pro plan).

## Phase 4 — Post-go-live smoke test

Using the first real admin: create a client, invite a consumer, run a nomination, submit a schedule, run a billing cycle. Watch `supabase--cloud_status`, edge function logs, and Project monitoring.

## Ongoing workflow

Keep building on the dev/preview environment. Publish to Live only after review — publishing is the promotion step.

## Inputs I need from you

1. **Custom domain** (e.g. `app.volttrade.com`) and whether it sits behind Cloudflare.
2. **Lovable URL slug** (default: `volttrade-erp`).
3. **First production admin email**.
4. Do you own the domain already, or should I point you at Lovable's "Buy new domain" flow?

I'll start Phase 1 as soon as you approve this plan; Phases 3–4 wait on the answers above.
