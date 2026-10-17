import { NextResponse, type NextRequest } from 'next/server';
import { createLogger, errorFields } from '@/lib/logger';
import { NO_STORE, supabaseServer } from '@/lib/supabase/server';
import { TRACE_HEADER, traceIdFrom } from '@/lib/trace';

// POST only, so a link or image can't sign someone out. Signs out this
// browser only; other devices keep their sessions.
export async function POST(request: NextRequest) {
  const log = createLogger(request.headers.get(TRACE_HEADER) ?? traceIdFrom(request.headers));
  const started = Date.now();
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    log.warn('auth.signout', { outcome: 'error', duration_ms: Date.now() - started, ...errorFields(error) });
    return NextResponse.redirect(`${request.nextUrl.origin}/deals?error=signout`, { status: 303, headers: NO_STORE });
  }
  log.info('auth.signout', { outcome: 'ok', duration_ms: Date.now() - started });
  return NextResponse.redirect(`${request.nextUrl.origin}/login`, { status: 303, headers: NO_STORE });
}
