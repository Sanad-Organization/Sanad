# 0001 — Stack and region

**Status:** accepted — 2026-10-13 (owner, architecture plan v2.0 "Locked decisions").

## Context

Sanad must ship an MVP in two weeks with one engineer and Claude Code, serve funds in MENA and Africa, and
handle founders' source code. Options considered: (A) one Next.js app with serverless functions only;
(B) Next.js + Supabase + a long-running Python worker + short-lived scan sandboxes; (C) a Kubernetes stack.
Scans and collection outlast serverless limits (A); (C) is too slow to build and run for one engineer.

## Decision

1. **Web:** Next.js (App Router, TypeScript) on Vercel, region `fra1`.
2. **Database, auth, files:** Supabase in `eu-central-1` (Frankfurt). Supabase has no Middle East region;
   Frankfurt is the closest. Sign-in by email magic link and Google.
3. **Worker and ingress:** Python 3.12 on Render, Frankfurt (ADR 0009 for the split).
4. **Scan sandboxes:** Fly Machines in `fra`, one machine per scan, no volume, destroyed after (ADR 0003).
5. **Search:** Voyage AI embeddings (1024 dimensions) in pgvector + Postgres full-text search, fused by
   reciprocal rank (`public.search_evidence`).
6. **Monitoring:** Sentry (errors), Langfuse (AI calls, cost), structured logs. **Flags:** PostHog,
   evaluated server-side only (bootstrap §11.4).
7. **Repository:** one pnpm monorepo; Python services use `uv` with locked dependencies.

## Consequences

- All data sits in the EU (Frankfurt). A fund that requires in-region storage is an open question
  (PROGRESS, Known issues); answering it later means a second Supabase project per region, not a rewrite.
- Four hosting vendors (Vercel, Supabase, Render, Fly) means four secret stores; the secrets runbook
  covers each.
- Swapping a vendor touches one service, because services talk through the database and signed HTTP only.
