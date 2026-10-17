# SPEC — PILOT-HARDEN

**Goal:** the first design-partner fund can use Sanad on real deals, and every MVP done-item is proven.

**Scope:** E2E flow inventory with Playwright (create deal → social → access link → scan → score →
approve → agent); evals green (`evals/reference`, `evals/social-labels`, `evals/injection`); alerts wired
(jobs reconcile, dead letters, scan failures, ingress 5xx, cost ceiling) each naming its runbook; runbooks
complete; restore drill and rollback drill recorded once; flag rollout plan (internal → pilot fund);
legal sign-off recorded (owner); security review of the sandbox recorded.
**Non-scope:** new features.

**Acceptance criteria:** every item in the architecture plan's "MVP definition of done" is checked with a
link to its proof (test run, eval report, drill record). **Estimate:** day 10 + week 3.
