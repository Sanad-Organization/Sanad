# Runbook — Ingress service

**What:** `services/ingress` (Render web service `sanad-ingress`, Frankfurt). It takes the GitHub App
webhook and install callback, and sandbox result uploads (ADR 0009). Those routes arrive with
GITHUB-ACCESS and SCAN-SANDBOX; today it serves `/health` only.

## Responses (never more detail than this)

| Status | Body | When |
| --- | --- | --- |
| 200 | `{"status":"ok","commit":"<sha>"}` | `GET /health` |
| 400 | `{"error":"bad_request"}` | malformed request (never echoes input) |
| 403 | `{"error":"forbidden"}` | any signature or token failure; the reason is in the log only |
| 404 | `{"error":"not_found"}` | unknown route (no docs or schema routes) |
| 408 | `{"error":"timeout"}` | body not received within 10 s (slow sender) |
| 413 | `{"error":"too_large"}` | body over the route's cap, checked on the stream |
| 503 | `{"error":"unavailable"}` | anything unhandled; GitHub redelivers |

## Signals in the logs

| Event | Level | Alert rule |
| --- | --- | --- |
| `request_failed` (fields `route`, `error_name`, `code`) | error | `ingress_errors`: page if > 3 in 5 min |
| `request_refused` (field `reason`) | warn | `ingress_refusals`: notify if > 20 in 10 min (a wrong secret, or someone probing) |
| `request_end` (fields `method`, `route`, `status`, `duration_ms`) | info | — |
| `config_missing` (field `name`) | error | the service refused to start: set that variable on Render |

## Rules for the routes still to come

- GITHUB-ACCESS and SCAN-SANDBOX routes each sit behind their feature flag and refuse on the server when it
  is off. The trace id for a webhook is server-generated; `X-GitHub-Delivery` is logged as its own field.
- The GitHub App id joins the ingress environment with GITHUB-ACCESS (ADR 0009).

## Secrets

`GITHUB_WEBHOOK_SECRET` and `SCAN_UPLOAD_SECRET`: at least 32 characters, random (for example
`openssl rand -hex 32`), and different from each other. The service refuses to start otherwise.

## Smoke after each deploy

- `GET https://<ingress host>/health` → `200` with the deployed commit.
- `GET https://<ingress host>/docs` → `404 {"error":"not_found"}`.
