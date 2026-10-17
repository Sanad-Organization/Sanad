# SPEC — SOCIAL-ANALYZE

**Goal:** the investor sees sentiment, pain points, praise, traction proxies and fake-traction signals,
each with sample size and dates, in Arabic and English content.

**Scope:** `mentions.label` (Haiku; language incl. Gulf, Levantine, Egyptian and Maghrebi Arabic;
sentiment; topics; complaint) writing only the enrichment columns; `social.analyze` (Sonnet: group
complaints into ≤ 5 pain points with shares and example mention ids; ≤ 3 praise themes; traction proxies;
fake-traction checks: follower jumps without engagement, engagement far below peers of similar size, bursts
of 5-star reviews, near-identical review text, deck numbers far above every proxy) writing a new
`social_summaries` version; findings for contradictions.
**Non-scope:** competitor comparison.

**Data:** `mentions` (enrichment), `social_summaries`, `findings`.
**Flag:** `social-overview`.

**Acceptance criteria**
- Labels agree with a human on ≥ 85 % of a 200-item synthetic-or-licensed Arabic/English sample
  (`evals/social-labels`). No real reviewer text committed to the repo.
- Figures from < 30 items carry `low_confidence: true`.
- Outputs schema-validated; a malformed model reply fails the job visibly after one retry.

**Slices:** (1) labelling; (2) analysis + findings. **Estimate:** 1 day.
