# SPEC — ANALYZE-SCORE

**Goal:** a cited, eight-dimension score with confidence, a verdict and founder questions, which a partner
can approve.

**Scope:** `deal.analyze` (findings per dimension from scan, outside-in, social and claims; top 10 code
issues become findings with fix cost and time; superseded findings marked, never deleted);
`deal.score` (new `scores` version: per dimension score 0–100, confidence, finding ids; "insufficient
evidence" when a dimension lacks sources; overall + verdict with Sanad default weights;
latest overrides applied); `questions.draft`. Opus writes only the verdict paragraph.
**Non-scope:** fund-specific weights (later).

**Data:** `findings`, `scores`, `questions`, `finding_overrides` (read).
**Flag:** `deal-room`.

**Acceptance criteria**
- Every score dimension lists the finding ids it used; every finding has sources (DB).
- An override triggers a new score version; approved versions never change (DB trigger + canary).
- Reference startups land in their expected verdict band.

**Slices:** one PR. **Estimate:** 1 day.
