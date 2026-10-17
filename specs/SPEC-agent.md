# SPEC — AGENT

**Goal:** a partner asks questions about a deal and gets answers that cite stored evidence, or a plain "no
evidence" with what to request.

**Scope:** Agent tab; `POST /api/deals/[id]/agent` (Next.js route, user's JWT, streams); Sonnet tool loop
with six read-only tools: `search_evidence`, `get_findings`, `get_claims`, `get_code_issues`,
`get_social_overview`, `draft_questions` (returns drafts; saving needs the user's click → RPC); every tool
queries Supabase **as the user** (RLS); evidence wrapped per ADR 0005; answer must cite source ids that the
tools returned (server checks before display); `log_agent_turn` after each answer; per-user rate limit.
**Non-scope:** cross-deal questions (FUND-COMPARE); any write tool.

**Data:** reads under RLS; writes `agent_turns` via RPC.
**Flag:** `agent`.

**Acceptance criteria**
- An answer citing a source id the tools did not return is rejected and regenerated once.
- Fund isolation: asking on deal A about fund B's company returns nothing from B (E2E with two funds).
- Injection eval: planted instructions in evidence don't change answers and are reported.
- Cost and tokens per turn logged; Langfuse trace per turn.

**Slices:** one PR. **Estimate:** 1.5 days.
