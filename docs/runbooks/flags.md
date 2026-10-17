# Runbook — Feature flags and the kill path

**Flags (registry: `packages/types/src/flags.ts`):** `app-shell`, `collect-web`, `github-scan`,
`social-overview`, `deal-room`, `agent`, `verdict-pdf`, `worker-kill` (inverse: on = worker paused).
All default **off**; evaluated server-side; anything but an explicit `true` means off.

## Turn a flag on for a pilot fund

1. PostHog → Feature flags → `<flag>` → release condition: `distinct_id` is `<fund id>`; rollout **100 %**
   (an active flag at 0 % looks on but evaluates off).
2. Toggle **active**.
3. Verify: as a member of that fund, the surface appears within 30 s; as another fund, it doesn't.

## Kill

1. Toggle the flag **inactive**. No redeploy.
2. Verify within 30 s: the page returns 404 and its API/RPC path refuses (`feature_off` in logs).
3. For the worker, turn `worker-kill` **on**: the worker stops claiming (`worker_paused` in logs); jobs wait.

## Drill

Run create → on → kill once per flag when it is created, and record the date in PROGRESS.
