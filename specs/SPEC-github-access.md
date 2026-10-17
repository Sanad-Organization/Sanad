# SPEC — GITHUB-ACCESS

**Goal:** an analyst sends a founder an access link; the founder installs the read-only GitHub App in under
5 minutes; Sanad records exactly which repositories it may read, and for how long.

**Scope:** "Request repository access" in the deal (calls `request_repo_access`, shows the link once with
Copy, optional "Email founder" via the web server's email provider); founder page `/access/[token]`
(static: what Sanad reads, retention, revocation, `[[HUMAN TEXT: founder data agreement]]`, install button
`https://github.com/apps/<slug>/installations/new?state=<token>`); ingress `GET /github/setup` and
`POST /github/webhook` (signature check, `installation` and `installation_repositories` events); public
repo detection from `deals.github_urls` (GitHub REST, unauthenticated or app-authenticated read);
`repo_connections` rows; job `github.revoke_expired` (deletes the installation after `access_ends_at`).
**Non-scope:** the scan itself; GitLab/Bitbucket.

**Data:** `repo_access_requests`, `repo_connections`, `audit_log`; jobs `scan.repo`.
**Flag:** `github-scan` (shared with SCAN-SANDBOX).

**Acceptance criteria**
- A link works once; an expired or replaced link shows a neutral "link no longer valid" page at GitHub
  callback time (ingress) with no hint which check failed.
- Wrong webhook signature → 403, logged with reason code, nothing written.
- Webhook handler failure → dead letter + 202; replay from the dead letter is idempotent.
- No access in 7 days → the deal shows "access requested, not granted" with the date.

**Slices:** (1) link + founder page; (2) ingress webhook + connections + revoke job. **Estimate:** 1 day.
