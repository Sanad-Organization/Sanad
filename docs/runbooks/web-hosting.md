# Runbook — Web app hosting (Vercel + Supabase Auth)

**Who:** the owner (hosted actions). **When:** once at setup, and when a domain changes.

## Vercel project `sanad` (team scope, created 2026-10-17)

- Root directory `apps/web`, framework Next.js, Node 22, functions in `fra1`.
- Previews behind Vercel Authentication.
- Environment variables (all environments): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (the **publishable** key), `POSTHOG_HOST`, `POSTHOG_PROJECT_KEY`. Production only, once a domain exists:
  `NEXT_PUBLIC_SITE_URL`. Later: `SENTRY_DSN`.
- Never add a service-role or secret key here (a test fails the build if code reads one).
- Git: Vercel → project → Settings → Git → connect the GitHub repository. The Vercel GitHub app must be
  installed on the organisation first.

## Supabase Auth (hosted project)

1. **Sign-ups off.** Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".
   Members are created by staff (`add-fund.md`).
2. **URL configuration.** Site URL = the production URL. Redirect URLs:
   - `https://<production domain>/**`
   - `https://*-<vercel team slug>.vercel.app/**` (previews)
   - `http://localhost:3000/**`
3. **Magic-link template** (Authentication → Emails → Magic link). The link must be:

   ```
   {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email
   ```

   The app sends `RedirectTo` as `<origin>/auth/confirm?next=<path>`, so the link returns to the host the
   member signed in from and works in any browser. Keep the rest of the template's wording as the owner
   approves it ([[HUMAN TEXT: magic-link email wording]]).
4. **Google provider** (optional): Authentication → Providers → Google, with a Google OAuth client whose
   redirect URI is `https://<project ref>.supabase.co/auth/v1/callback`. With sign-ups off, only existing
   members can sign in with Google.

## Smoke after each deploy

- `GET /api/health` → `200 {"status":"ok","sha":"<commit>"}`.
- `/deals` signed out → redirect to `/login`.
- Sign in as a pilot member → `/deals` shows the fund (flag on) or 404 (flag off).

## Alerts (log events)

| Event | Rule |
| --- | --- |
| `auth.callback` / `auth.confirm` with `outcome=error` | notify if > 5 in 10 min (links failing) |
| `proxy.auth_degraded` | notify if > 20 in 5 min (Supabase Auth slow or down) |
| `feature_off` with `outcome` `timeout` or `error` | notify if > 10 in 5 min (PostHog unreachable: flags fail closed) |
| `session.memberships_failed` | page on any (members can't load their funds) |
