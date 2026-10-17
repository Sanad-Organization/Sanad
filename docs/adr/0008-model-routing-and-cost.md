# 0008 — AI model routing and cost tracking

**Status:** accepted — 2026-10-13 (architecture plan "Locked decisions").

## Decision

1. One model layer (`services/worker/sanad_worker/llm/`, and `apps/web/lib/llm/` for the agent) — no direct
   SDK calls elsewhere.
2. **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`): mention labelling (language incl. Arabic dialects,
   sentiment, topics, complaint), claim extraction, profile matching.
3. **Claude Sonnet 5.5** (`claude-sonnet-5-5`): pain-point grouping, social summary, claim checks,
   findings, scoring, the agent.
4. **Claude Opus 5.5** (`claude-opus-5-5`): only the final verdict write-up.
5. Every call: structured output parsed by a JSON Schema; timeout; one retry; Langfuse trace with
   `deal_id`, `fund_id`, job id, tokens and cost; no personal data in the trace beyond what the prompt
   needs. Model ids come from config, not code.
6. A per-deal cost ceiling (config, first guess $15) stops non-essential AI steps and marks the deal
   "partial" rather than overspending.

## Consequences

- Model upgrades are a config change plus an eval run (`evals/`).
