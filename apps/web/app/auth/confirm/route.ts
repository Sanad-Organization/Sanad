import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createLogger, errorFields } from '@/lib/logger';
import { safeNextPath } from '@/lib/redirect';
import { NO_STORE, supabaseServer } from '@/lib/supabase/server';
import { TRACE_HEADER, traceIdFrom } from '@/lib/trace';

// Magic links land here with a token hash (no PKCE verifier needed), so a link
// opened on a phone or in a mail app's browser still signs the user in.
const TYPES = new Set<EmailOtpType>(['email', 'magiclink']);

export async function GET(request: NextRequest) {
  const log = createLogger(request.headers.get(TRACE_HEADER) ?? traceIdFrom(request.headers));
  const started = Date.now();
  const sp = request.nextUrl.searchParams;
  const tokenHash = sp.get('token_hash');
  const type = sp.get('type') as EmailOtpType | null;
  const next = safeNextPath(sp.get('next'));
  const done = (path: string, outcome: string, fields = {}) => {
    log[outcome === 'ok' ? 'info' : 'warn']('auth.confirm', { outcome, duration_ms: Date.now() - started, ...fields });
    return NextResponse.redirect(`${request.nextUrl.origin}${path}`, { headers: NO_STORE });
  };
  if (!tokenHash || !/^[A-Za-z0-9_-]{8,128}$/.test(tokenHash) || !type || !TYPES.has(type)) {
    return done('/login?error=link', 'bad_link');
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return done('/login?error=link', 'error', errorFields(error));
  return done(next, 'ok');
}
