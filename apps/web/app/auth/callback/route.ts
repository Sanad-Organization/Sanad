import { NextResponse, type NextRequest } from 'next/server';
import { createLogger, errorFields } from '@/lib/logger';
import { safeNextPath } from '@/lib/redirect';
import { NO_STORE, supabaseServer } from '@/lib/supabase/server';
import { TRACE_HEADER, traceIdFrom } from '@/lib/trace';

// Google OAuth returns here with a one-time code (PKCE; the verifier cookie is
// on this host because the redirect URL was built from the browsing origin).
export async function GET(request: NextRequest) {
  const log = createLogger(request.headers.get(TRACE_HEADER) ?? traceIdFrom(request.headers));
  const started = Date.now();
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  const done = (path: string, outcome: string, fields = {}) => {
    log[outcome === 'ok' ? 'info' : 'warn']('auth.callback', { outcome, duration_ms: Date.now() - started, ...fields });
    return NextResponse.redirect(`${origin}${path}`, { headers: NO_STORE });
  };
  if (!code) return done('/login?error=link', 'no_code');
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return done('/login?error=link', 'error', errorFields(error));
  return done(next, 'ok');
}
