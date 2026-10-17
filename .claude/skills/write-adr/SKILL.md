---
name: write-adr
description: Record a significant Sanad decision as an ADR in docs/adr. Use when a choice would surprise a future reader, sets a limit, accepts a risk, or records an owner decision.
---

File: `docs/adr/NNNN-short-title.md` (next free number). Template:

```markdown
# NNNN — <title>

**Status:** proposed | accepted — <date> (<who>, <where decided>).

## Context
<forces, constraints, options considered (A/B/C)>

## Decision
<what was chosen, with conditions; numbered if several>

## Consequences
<good and bad; follow-ups; accepted risks and known gaps, stated explicitly>
```

Amend, never rewrite: add `## <Amendment> (amended <date>, <who>)`. Mark superseded ADRs, don't delete.
Reference the ADR from the code it governs (a comment) and the code from the ADR (paths). Owner decisions
are `accepted` only once the owner said so; otherwise `proposed` and a decision thread in PROGRESS.
