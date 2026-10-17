# SPEC — SCAN-SANDBOX

**Goal:** within 30 minutes of access, Sanad knows the repository's vulnerabilities, secrets in history,
misconfigurations, size, contributors, AI usage, paid services and cleanup signals — and the code is gone.

**Scope:** `services/scanner` image (pinned Trivy + DB mirror date, Gitleaks `--redact`, Opengrep,
scc; non-root; read-only root FS except `/work` tmpfs); `run.py` (clone full history of the default branch,
scan `head` and `before_request`, merge, normalise, fingerprint, strip, POST results); Sanad analyses
(history: commits over time, contributors, top-contributor share, first commit, force pushes via the
repository activity API, commits after `requested_at`; AI usage map; paid services map); `rules/opengrep`
(~40 rules, each with positive and negative fixtures); worker job `scan.repo` (create Fly Machine with no
volume, egress allow-list, mint 1-hour installation token + per-scan upload token, wait, destroy, record
`sandbox_destroyed_at`, mark scan done/failed); ingress `POST /scans/{id}/results`.
**Non-scope:** licence detection inside source files; active testing of the running product.

**Data:** `scans`, `code_issues`, `sources` (type `repository`), `deals.pipeline`.
**Flag:** `github-scan`.

**Acceptance criteria (full adversarial review)**
- **Leak test:** a synthetic repo with planted secrets and distinctive code strings is scanned; CI greps the
  DB dump, storage, worker/ingress logs, Sentry events and Langfuse traces for every planted string → 0 hits.
- A scan can't be stored as done without `sandbox_destroyed_at` (DB) and the worker destroys the machine
  in a `finally` (test with a crashing scanner).
- Test repos built to hide things: secret removed in the last commit; commits after the request; a force
  push; a history that starts last month → each detected.
- 10 known-vulnerable open-source test repos: expected CVEs, secrets and misconfigurations found.
- Upload token: wrong scan id, reuse, expiry → 403.

**Slices:** (1) image + run.py + rules with tests; (2) worker orchestration + ingress results; (3) cleanup
signals + AI/services maps. **Estimate:** 2–2.5 days.
