import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { fallbackOrigin } from './env';
import { createLogger, type Logger } from './logger';
import { originFrom } from './origin';
import { TRACE_HEADER, traceIdFrom } from './trace';

/** The request's logger. The proxy stamps the trace id; this reuses it. */
export const requestLogger = cache(async (): Promise<Logger> => {
  const h = await headers();
  return createLogger(h.get(TRACE_HEADER) ?? traceIdFrom(h));
});

/** The origin the user is browsing, for links that must come back to the same host. */
export async function requestOrigin(): Promise<string> {
  return originFrom(await headers(), fallbackOrigin());
}

/** Logs `action.start` now and returns a function that logs `action.end` with outcome and duration. */
export async function startAction(action: string) {
  const log = await requestLogger();
  const started = Date.now();
  log.info('action.start', { action });
  return {
    log,
    end(outcome: string, fields: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info') {
      log[level]('action.end', { action, outcome, duration_ms: Date.now() - started, ...fields });
    },
  };
}
