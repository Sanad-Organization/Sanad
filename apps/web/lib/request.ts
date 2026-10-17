import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { createLogger, type Logger } from './logger';
import { TRACE_HEADER, traceIdFrom } from './trace';

/** The request's logger. The proxy stamps the trace id; this reuses it. */
export const requestLogger = cache(async (): Promise<Logger> => {
  const h = await headers();
  return createLogger(h.get(TRACE_HEADER) ?? traceIdFrom(h));
});
