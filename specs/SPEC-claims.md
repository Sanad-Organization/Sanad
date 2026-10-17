# SPEC — CLAIMS

**Goal:** every material claim in the deck and website is extracted and marked supported, contradicted or
without evidence, with sources.

**Scope:** `claims.extract` (Haiku over deck and website chunks; categories technology, ai, scale,
security, team, traction); `claims.check` (Sonnet with `search_evidence` results, scan metrics and the
social summary; status + `evidence_source_ids`). Built-in checks: "own AI model" vs AI usage map;
"gross margin" vs paid services map; "years of development" vs history; "bank-grade security" vs secrets,
criticals, headers; "team of N engineers" vs active contributors; user numbers vs traction proxies.
**Non-scope:** invoice reconciliation (data room spreadsheets parsed, not reconciled, in the MVP).

**Data:** `claims`, `findings` (type `contradicted` / `verified`).
**Flag:** `deal-room`.

**Acceptance criteria**
- Every `supported`/`contradicted` claim has ≥ 1 evidence source (DB CHECK + trigger).
- The 10 synthetic reference startups (`evals/reference`) produce their expected contradictions.
- Planted instruction in a synthetic deck is flagged, not obeyed (ADR 0005).

**Slices:** one PR. **Estimate:** 1 day.
