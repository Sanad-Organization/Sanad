import 'server-only';
import { cache } from 'react';
import type { FlagKey } from '@sanad/types';
import { evaluateFlag } from './flags';
import { requestLogger } from './request';

/** One evaluation per flag, fund and request. Off unless PostHog says exactly `true`. */
export const flagOn = cache(async (flag: FlagKey, fundId: string): Promise<boolean> => {
  const started = Date.now();
  const result = await evaluateFlag(flag, fundId, {
    host: process.env.POSTHOG_HOST,
    projectKey: process.env.POSTHOG_PROJECT_KEY,
  });
  const log = await requestLogger();
  const level = result.reason === 'on' || result.reason === 'off' ? 'debug' : 'warn';
  log[level](result.on ? 'flag_on' : 'feature_off', {
    flag,
    fund_id: fundId,
    outcome: result.reason,
    duration_ms: Date.now() - started,
  });
  return result.on;
});
