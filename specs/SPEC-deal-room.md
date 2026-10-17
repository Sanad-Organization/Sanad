# SPEC — DEAL-ROOM

**Goal:** a partner reads one deal end to end — overview, social, code and security, claims — and acts:
override, approve, set status, request access, confirm profiles.

**Scope:** `/deals/[id]` with tabs Overview (verdict, scores with confidence, top findings, pipeline
progress from `deals.pipeline`), Social (audience, growth, proxies, sentiment with n and dates, pain points
with example quotes, fake-traction signals), Code and security (scan summary, commit scanned, sandbox
destroyed time, issues table by category and severity, AI usage map, paid services map, cleanup signals),
Claims (each with status and sources), Questions. Every number links to its source. Actions call the RPCs.
Empty, loading, partial and failed states for every section.
**Non-scope:** the Agent tab (AGENT), PDF (VERDICT-PDF).

**Data:** reads only, under RLS; one read RPC per tab if a page needs more than 3 queries.
**Flag:** `deal-room`.

**Acceptance criteria**
- Viewer sees no action buttons, and the RPCs refuse anyway (server-side).
- Every figure from < 30 items shows "low confidence".
- Visual self-check against the approved design (text-only PR note); axe clean.

**Slices:** (1) Overview + Code and security; (2) Social + Claims + Questions + actions. **Estimate:** 2 days.
