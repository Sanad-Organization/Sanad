# 0009 — Four services, and which key each may hold

**Status:** accepted — 2026-10-13 (agent proposal under bootstrap §9.1; amends architecture plan "API
endpoints": the GitHub webhook and scan results move from Next.js to the ingress service).

## Context

The architecture plan put the GitHub webhook and the sandbox result upload inside Next.js. Both need the
service role to write. The bootstrap forbids the service-role key in an app.

## Decision

| Service | Holds | Never holds |
| --- | --- | --- |
| `apps/web` (Vercel) | Supabase URL + anon key; Anthropic + Voyage keys for the agent; PostHog server key; GitHub App **slug** (for the install URL) | service-role key, GitHub App private key, any scanner token |
| `services/ingress` (Render web) | service-role key; GitHub webhook secret; GitHub App id; scan-upload signing secret | Anthropic key |
| `services/worker` (Render worker) | service-role key; GitHub App private key (mints installation tokens); Fly API token; X, Bright Data, Anthropic, Voyage keys; scan-upload signing secret | — |
| `services/scanner` (Fly Machine) | one installation token (≤ 1 h) + one per-scan upload token, passed at start | anything long-lived; no database credentials |

1. The founder access page (`/access/[token]`) is static in `apps/web`: it shows what Sanad reads, the
   founder data agreement (`[[HUMAN TEXT]]`) and the GitHub install button with `state=<token>`. It reads
   nothing from the database.
2. GitHub's setup redirect and webhook go to the ingress. The ingress verifies `X-Hub-Signature-256`
   (constant time), hashes `state`, calls `ingress_claim_access_request`, writes `repo_connections` and
   enqueues `scan.repo`. Unprocessable payloads go to `dead_letter_add` and return 202.
3. Sandbox results: `POST /scans/{id}/results` with `Authorization: Bearer <per-scan token>`
   (HMAC of scan id + expiry with the signing secret; valid once, for that scan only); body schema-validated
   and capped; no field may contain code.

## Consequences

- One more Render service (small). Contract tests pin the JSON Schemas the ingress and scanner share.
