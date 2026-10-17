# 0007 — Repository visibility and GitHub plan

**Status:** accepted — 2026-10-17 (owner): option B, public repository, with the confidential documents kept out of git.

## Context

The bootstrap's merge wall relies on GitHub rulesets (required checks, no bypass, CODEOWNERS). On the free
plan, rulesets are not enforced on **private** repositories (bootstrap §21.5). Sanad's code is commercial;
its security rules and scan analysis are part of the product's value, and a public repository would also
show attackers exactly what Sanad does and doesn't detect.

## Options

- **A) Private repository on GitHub Team (per-user monthly fee):** rulesets enforced, code private.
- **B) Public repository on the free plan:** rulesets enforced, but rules, prompts and detection gaps are
  public; every commit must be written as if competitors read it.
- **C) Private on the free plan:** no enforced merge wall; the bootstrap's main control is missing.

## Recommendation

**A.** The merge wall is a blocking control in the contract, and the rule pack is product IP.

## Consequences

- Option A needs a paid organisation before HARNESS can be marked done.
- Whatever is chosen, `.gitignore`'s secrets block and the secret scans stay as if the repo were public.

## Decision (2026-10-17, owner)

The repository `Sanad-Organization/Sanad` is **public**. Rulesets are enforced on public repositories on the
free plan, so the merge wall holds. To limit what is public:

1. The architecture plan, concept brief and engineering contract live in `docs/private/` (git-ignored).
   The owner copies them in from the Project; agents stop and ask if they are missing.
2. The published history starts from a fresh commit that never contained those files.
3. Every commit, PR and issue is written as if competitors read it: no prospect, fund or founder names, no
   infrastructure identifiers (project refs go in CI variables), no detection gaps described in prose.
4. The security rule pack (`rules/opengrep/`) is public by consequence. Revisit (move it to a private
   package or repository) before the first paying fund, if detection evasion becomes a concern.
