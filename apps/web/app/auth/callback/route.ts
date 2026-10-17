import { NextResponse, type NextRequest } from 'next/server';
import { siteUrl } from '@/lib/env';
import { createLogger, errorFields } from '@/lib/logger';
import { safeNextPath } from '@/lib/redirect';
import { supabaseServer } from '@/lib/supabase/server';
import { TRACE_HEADER, traceIdFrom } from '@/lib/trace';

// Magic-link and OAuth return here with a one-time code (PKCE).
export async function GET(request: NextRequest) {
  const log = createLogger(request.headers.get(TRACE_HEADER) ?? traceIdFrom(request.headers));
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  const base = siteUrl();
  if (!code) {
    log.info('auth.callback', { outcome: 'no_code' });
    return NextResponse.redirect(`${base}/login?error=link`);
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    log.warn('auth.callback', { outcome: 'error', ...errorFields(error) });
    return NextResponse.redirect(`${base}/login?error=link`);
  }
  log.info('auth.callback', { outcome: 'ok' });
  return NextResponse.redirect(`${base}${next}`);
}
