// One trace id per request (bootstrap §9): Vercel's request id when present,
// else a well-formed x-request-id, else a fresh UUID. Anything else is ignored
// so a caller can't inject log content through the header.
const WELL_FORMED = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/;

export const TRACE_HEADER = 'x-sanad-trace-id';

export function traceIdFrom(headers: { get(name: string): string | null }): string {
  for (const name of ['x-vercel-id', 'x-request-id']) {
    const v = headers.get(name)?.trim();
    if (v && WELL_FORMED.test(v)) return v;
  }
  return crypto.randomUUID();
}
