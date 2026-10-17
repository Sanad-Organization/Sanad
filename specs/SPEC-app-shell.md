# SPEC — APP-SHELL

**Goal:** a signed-in fund member can see their fund's deals and create a deal, with logging, errors,
flags and the fund switcher in place (priorities 1 and 2).

**Scope:** `apps/web` on Next.js App Router; Supabase SSR auth (magic link + Google); fund switcher (a user
in several funds picks one; every query filters by it); deals list; "New deal" form calling `create_deal`;
`packages/design-tokens` + base `packages/ui` (button, input, table, card, badge, empty state); structured
logger with `trace_id` (from `x-vercel-id`, else a well-formed `x-request-id`, else a UUID) and redaction;
Sentry; PostHog server-side flag client with the `FLAGS` registry, 1.5 s timeout, fail closed;
`/api/health` returning the commit SHA; Vercel preview deploys.
**Non-scope:** deal room tabs (DEAL-ROOM), invites, billing, Arabic UI.

**Surfaces:** `/login`, `/deals`, `/deals/new`, `/api/health`.
**Data:** reads `funds`, `memberships`, `deals`, `companies`; writes via `create_deal` only.
**Flag:** `app-shell` (pilot funds by `fund_id`).

**Acceptance criteria**
- No service-role key anywhere in `apps/web` (lint rule + CI grep).
- A user of fund A never sees fund B in the switcher or list (Playwright test with two seeded users).
- `create_deal` errors map to messages (`42501` → "You don't have permission", check violations → field
  errors); every server action logs entry/exit with outcome.
- Flag off → pages 404 and actions refuse; flag service down → off, health still 200.
- Lighthouse a11y ≥ 95 on `/deals`; axe clean on the form.

**Slices:** (1) auth + shell + logger + flags + health; (2) deals list + new deal. **Estimate:** 1 day.
