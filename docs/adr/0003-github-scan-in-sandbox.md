# 0003 — Scan code from GitHub inside a destroyed-after sandbox

**Status:** accepted — 2026-10-13 (owner: "scan automatically from the platform … no local machine thing").

## Context

A founder who runs a scanner locally can clean up first. The investor needs the code as it lives on the
default branch, with its history. Founders need to trust that their code is not kept.

## Decision

1. **Access:** public repositories are scanned at once. Private ones through the **Sanad GitHub App**
   (read-only: contents + metadata), installed by the founder from an access link. The link's token is
   244 random bits, returned once to the analyst; only its SHA-256 is stored; it works once and expires in
   14 days. Sanad removes its installation 30 days after connection (`access_ends_at`).
2. **Sandbox:** the worker starts one Fly Machine per scan from a pinned image, passes a one-hour
   installation token and a **per-scan upload token**, and the machine clones the default branch with full
   history, runs Trivy, Gitleaks (`--redact`), Opengrep (unmodified engine, Sanad's own rules), scc and
   Sanad's analyses, strips snippets and secret values, posts results to the ingress, and exits. The worker
   destroys the machine and records `sandbox_destroyed_at`; a scan can't be `done` without it (DB CHECK).
   Egress is limited to GitHub, the vulnerability DB mirror and the ingress.
3. **Cleanup detection:** scan `head` and `before_request` (the last commit before `requested_at`); list
   commits after the request; read force pushes from GitHub's repository activity API; secrets in history.
4. **Licences:** Trivy (Apache-2.0), trivy-checks (MIT), Gitleaks (MIT), Opengrep (LGPL-2.1, run unmodified
   as a separate binary), scc (MIT). Semgrep and Opengrep community rules are **not** used (commercial use
   barred / Commons Clause). Re-check licences when pinning new versions.

## Consequences

- Code never reaches Sanad's database, storage, logs or prompts; `code_issues` has no column that could
  hold it (test + canary). The leak test (planted secrets) runs in CI on the scanner image.
- Scan cost is one machine-minute count per scan; logged per deal.
- A founder can revoke at any time; the deal then shows the last scan and "access revoked".
