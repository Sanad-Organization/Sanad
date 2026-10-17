// Structured JSON logs (bootstrap §9): one line per event, a trace_id on every
// line, no PII, no payloads, no error messages. Only allow-listed scalar fields
// are written; everything else is dropped, so a careless call can't leak data.
export type Level = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const ALLOWED_FIELDS = new Set([
  'action',
  'outcome',
  'duration_ms',
  'status',
  'code',
  'error_name',
  'flag',
  'fund_id',
  'deal_id',
  'user_id',
  'route',
  'method',
  'reason',
  'count',
]);
const MAX_STRING = 200;

// Second line of defence: values that look like personal data or credentials
// are replaced even in allowed fields.
const REDACT: RegExp[] = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\b(bearer|basic)\s+\S+/i, // auth header value
  /\b(sb|phc|phx|sk|pk|ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{8,}/, // key prefixes
  /\?[^\s]*=/, // query string
];

function redactValue(v: string): string {
  return REDACT.some((re) => re.test(v)) ? '[redacted]' : v.slice(0, MAX_STRING);
}

function clean(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = redactValue(v);
  }
  return out;
}

/** The error's class name and code only: messages can carry user input. */
export function errorFields(err: unknown): LogFields {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown };
    return {
      error_name: typeof e.name === 'string' ? e.name : 'Error',
      ...(typeof e.code === 'string' ? { code: e.code } : {}),
    };
  }
  return { error_name: typeof err };
}

export type Sink = (line: string) => void;

const defaultSink: Sink = (line) => {
  const out = globalThis.process?.stdout;
  if (out?.write) out.write(line + '\n');
  else console.error(line);
};

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  traceId: string;
}

export function createLogger(traceId: string, sink: Sink = defaultSink): Logger {
  const write = (level: Level, event: string, fields: LogFields = {}) =>
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        service: 'web',
        event: event.slice(0, 100),
        trace_id: traceId,
        ...clean(fields),
      }),
    );
  return {
    traceId,
    debug: (e, f) => write('debug', e, f),
    info: (e, f) => write('info', e, f),
    warn: (e, f) => write('warn', e, f),
    error: (e, f) => write('error', e, f),
  };
}
