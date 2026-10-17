---
name: write-feature-spec
description: Write a buildable, checkable spec for a Sanad backlog task in specs/. Use before building anything without a spec.
---

File: `specs/SPEC-<task-id-lowercase>.md`. Sections, tight:

1. **Goal** — one sentence naming the priority it serves.
2. **Scope / Non-scope** — bullets; non-scope matters as much.
3. **Surfaces** — pages, endpoints, jobs.
4. **Data** — tables read/written, new columns, RLS impact, new jobs and payload schemas.
5. **Flag** — its key in `packages/types/src/flags.ts`.
6. **Acceptance criteria** — testable bullets incl. the relevant Definition-of-Done items (isolation test,
   logging + alert, degraded mode, synthetic names only).
7. **Slices / PR plan** — database first and alone; 2–3 PRs max; each mergeable behind the flag.
8. **Estimate.**

A spec grants no access to anything. Human-only text (founder agreement, legal, consent) appears only as
`[[HUMAN TEXT: <what>]]`. The owner queues the task in BACKLOG; the agent only proposes.
