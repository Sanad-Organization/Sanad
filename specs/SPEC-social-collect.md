# SPEC — SOCIAL-COLLECT

**Goal:** within an hour of deal creation, Sanad has proposed the company's profiles and, once confirmed,
collected their audience numbers, posts, reviews and public mentions.

**Scope:** jobs `social.discover` (search official sites' links, app stores, X, Bright Data search; propose
`social_profiles` with a match reason; Haiku checks same-name confusion), `social.collect` per confirmed
profile (X API; Bright Data for Instagram, Facebook, TikTok, LinkedIn company page, Reddit; Apple RSS
reviews; Google Play listing), `mentions.collect` (web/news/Reddit mentions). Snapshots per run; mentions
deduped on `(deal_id, platform, external_id)`; `author_hash` = SHA-256(salt + platform + author id);
cost logged per deal. Profile confirmation UI (list with Confirm / Reject) calling `set_profile_status`.
**Non-scope:** labelling and summaries (SOCIAL-ANALYZE); personal profiles; anything behind a login.

**Data:** `social_profiles`, `profile_snapshots`, `mentions`, `sources`.
**Flag:** `social-overview`.

**Acceptance criteria**
- Only confirmed profiles are collected (test).
- No author name or handle is stored (schema + test on stored rows).
- Vendor outage → the deal shows "Instagram unavailable, retrying" and the rest continues (degraded mode).
- Recorded per-deal cost for X reads and Bright Data records.

**Slices:** (1) discovery + confirmation UI; (2) collectors. **Estimate:** 1.5 days.
