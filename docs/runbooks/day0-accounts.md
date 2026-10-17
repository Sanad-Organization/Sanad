# Runbook — Day 0: accounts and hosted setup (owner)

Do these first; approvals take days. Record each done item in PROGRESS.

1. **GitHub:** organisation + repository per ADR 0007; enable the ruleset on `main` (required checks
   `verify`, `isolation`, `secrets`, `guard (ubuntu-24.04)`, `guard (macos-15)`; squash only; require CODEOWNERS review; no bypass actors).
2. **Supabase:** project in `eu-central-1`; enable pgvector (`extensions` schema); Auth: magic link +
   Google, site URL = production domain; add repository secrets `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_DB_PASSWORD`, variable `SUPABASE_PROJECT_REF` for the migration workflow.
3. **Vercel:** project from `apps/web`, region `fra1`, preview deployments behind Vercel login.
4. **Render:** worker service, ingress web service, two crons (minute sweep, daily reconcile), Frankfurt.
5. **Fly:** organisation, app `sanad-scanner` in `fra`, deploy token scoped to it.
6. **GitHub App "Sanad":** permissions Contents: read, Metadata: read; events Installation, Installation
   repositories; setup URL and webhook URL = ingress; "Any account" can install.
7. **Data vendors:** X developer account with credits; Bright Data business account (verification).
8. **Keys:** Anthropic, Voyage AI, Sentry, Langfuse, PostHog, email sending provider.
9. **Legal (HUMAN ONLY):** send ADR 0004's rules and the founder data agreement for review.
10. **Evals:** pick 10 reference cases and 10 known-vulnerable open-source repositories; record them as
    **synthetic profiles** in `evals/` (no real company names in the repo).
11. **CODEOWNERS:** replace `@OWNER` in `.github/CODEOWNERS` with your GitHub handle (the agent can't edit it).
12. **GitHub environment `production`:** required reviewer = you; add `SUPABASE_ACCESS_TOKEN`,
    `SUPABASE_DB_PASSWORD` as environment secrets and `SUPABASE_PROJECT_REF` as a variable. Migrations
    apply only after you approve each run.
13. **Confidential docs:** copy the architecture plan, concept brief and engineering bootstrap from the
    Project into `docs/private/` in your local clone (git-ignored; the repo is public, ADR 0007).
