# Runbook — Secrets: where they live and how to rotate

Generate random values locally (`openssl rand -hex 32`). Never paste one into chat, tickets or PRs.

| Secret | Lives in | Used by | Rotate |
| --- | --- | --- | --- |
| Supabase service-role key | Render (worker, ingress), GitHub Actions (migrations) | DB writes | Supabase → API → roll; update both Render services, then CI; verify `/health` |
| GitHub App private key | Render (worker) | minting installation tokens | GitHub App → generate new key; deploy; delete the old key |
| GitHub webhook secret | Render (ingress), GitHub App settings | webhook signatures | set new value in both within one minute; failed deliveries are redelivered from GitHub |
| Scan upload signing secret | Render (worker, ingress) | per-scan tokens | change both, then restart; in-flight scans fail and retry |
| Anthropic, Voyage keys | Vercel (agent), Render (worker) | models | provider console → new key → update → revoke old |
| X API, Bright Data | Render (worker) | collection | provider console |
| Fly API token | Render (worker) | sandboxes | Fly → tokens → new deploy token scoped to the scan app |
| PostHog server key, Sentry DSN | Vercel, Render | flags, errors | provider console |

**Verify after any rotation:** `/api/health` (web) and `/health` (ingress) return 200 with the current SHA;
one test deal runs end to end on the staging fund.
