// Server-side flag client (bootstrap §11.4). PostHog evaluates per fund
// (distinct_id = fund id; nothing else is sent). Fails closed: anything but an
// explicit `true` is OFF — timeout, network error, non-200, malformed body,
// partial evaluation, missing config.
import { isOn, type FlagKey } from '@sanad/types';

export const FLAG_TIMEOUT_MS = 1500;

export interface FlagConfig {
  host: string | undefined;
  projectKey: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type FlagResult = { on: boolean; reason: 'on' | 'off' | 'no_config' | 'timeout' | 'error' | 'bad_response' };

export async function evaluateFlag(flag: FlagKey, fundId: string, cfg: FlagConfig): Promise<FlagResult> {
  if (!cfg.host || !cfg.projectKey || !fundId) return { on: false, reason: 'no_config' };
  const doFetch = cfg.fetch ?? fetch;
  // One budget for the whole evaluation; a fast network error gets one retry inside it.
  const signal = AbortSignal.timeout(cfg.timeoutMs ?? FLAG_TIMEOUT_MS);
  let last: FlagResult = { on: false, reason: 'error' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await doFetch(new URL('/flags?v=2', cfg.host), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: cfg.projectKey, distinct_id: fundId, flag_keys_to_evaluate: [flag] }),
        signal,
        cache: 'no-store',
      });
      if (res.status >= 500) {
        last = { on: false, reason: 'error' };
        continue;
      }
      if (!res.ok) return { on: false, reason: 'error' };
      return readFlag(await res.json(), flag);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'TimeoutError' || name === 'AbortError' || signal.aborted) return { on: false, reason: 'timeout' };
      if (name === 'SyntaxError') return { on: false, reason: 'bad_response' };
      last = { on: false, reason: 'error' };
    }
  }
  return last;
}

export function readFlag(body: unknown, flag: string): FlagResult {
  if (!body || typeof body !== 'object') return { on: false, reason: 'bad_response' };
  const b = body as { errorsWhileComputingFlags?: unknown; flags?: unknown; featureFlags?: unknown };
  if (b.errorsWhileComputingFlags === true) return { on: false, reason: 'bad_response' };
  if (b.flags && typeof b.flags === 'object') {
    const entry = (b.flags as Record<string, unknown>)[flag];
    const enabled = entry && typeof entry === 'object' ? (entry as { enabled?: unknown }).enabled : undefined;
    return isOn(enabled) ? { on: true, reason: 'on' } : { on: false, reason: 'off' };
  }
  if (b.featureFlags && typeof b.featureFlags === 'object') {
    const v = (b.featureFlags as Record<string, unknown>)[flag];
    return isOn(v) ? { on: true, reason: 'on' } : { on: false, reason: 'off' };
  }
  return { on: false, reason: 'bad_response' };
}
