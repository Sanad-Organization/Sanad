# BACKLOG

Ordered work queue. The agent takes the **first `queued` task whose dependencies are `done`** and only
updates **Status**. Only the owner adds, removes, or reorders tasks.

Status: `queued` · `in-progress` · `blocked` (reason required) · `done` · `awaiting-spec` · `held`

| #   | Task ID         | Spec                              | Depends on | Status | Notes                                                                 |
| --- | --------------- | --------------------------------- | ---------- | ------ | --------------------------------------------------------------------- |
| 1   | HARNESS         | specs/SPEC-harness.md             | —          | in-progress | Pushed 2026-10-17; owner: ruleset, CODEOWNERS, secrets |
| 2   | DB-SPINE        | specs/SPEC-db-spine.md            | #1         | in-progress | On main; apply to hosted DB via migrate workflow |
| 3   | APP-SHELL       | specs/SPEC-app-shell.md           | #2         | queued | Day 1                                                                 |
| 4   | WORKER-CORE     | specs/SPEC-worker-core.md         | #2         | queued | Day 1–2; parallel with #3                                             |
| 5   | COLLECT-WEB     | specs/SPEC-collect-web.md         | #4         | queued | Day 2–3; website, news, outside-in check, deck files, embeddings      |
| 6   | GITHUB-ACCESS   | specs/SPEC-github-access.md       | #3, #4     | queued | Day 3; needs the GitHub App registered (owner, day 0)                 |
| 7   | SCAN-SANDBOX    | specs/SPEC-scan-sandbox.md        | #6         | queued | Day 3–5; full adversarial review                                      |
| 8   | SOCIAL-COLLECT  | specs/SPEC-social-collect.md      | #4         | queued | Day 4–5; X API first if Bright Data verification is pending           |
| 9   | SOCIAL-ANALYZE  | specs/SPEC-social-analyze.md      | #8         | queued | Day 6                                                                 |
| 10  | CLAIMS          | specs/SPEC-claims.md              | #5         | queued | Day 6                                                                 |
| 11  | ANALYZE-SCORE   | specs/SPEC-analyze-score.md       | #7, #9, #10 | queued | Day 7                                                                |
| 12  | DEAL-ROOM       | specs/SPEC-deal-room.md           | #3, #11    | queued | Day 7–9; UI slices can start on fixtures from day 5                   |
| 13  | AGENT           | specs/SPEC-agent.md               | #11        | queued | Day 8–9                                                               |
| 14  | PILOT-HARDEN    | specs/SPEC-pilot-harden.md        | #12, #13   | queued | Day 10 + week 3: evals, E2E, alerts, runbooks, legal sign-off          |
| 15  | VERDICT-PDF     | specs/SPEC-verdict-pdf.md         | #12        | queued | Week 3 if the 2-week line holds (owner decision, see PROGRESS)        |
| 16  | TEAM-INVITES    | —                                 | #3         | awaiting-spec | Pilot: staff add members by runbook (docs/runbooks/add-fund.md) |
| 17  | FUND-COMPARE    | —                                 | #14        | held   | Right after the MVP (owner, 2026-10-13)                               |
| 18  | COMPETITORS     | —                                 | #17        | held   | Phase 2 (owner, 2026-10-13)                                           |
| 19  | FOUNDER-SELF-ASSESS | —                             | #14        | held   | Only when the fund allows it (`funds.allow_founder_self_assessment`)  |

## Blocked log

_(agent appends: date · task · reason · decision-thread link)_
