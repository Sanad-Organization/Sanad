// Runs before every page request: stamps the trace id and refreshes the
// Supabase session cookie (the user's JWT). It does not decide access; RLS
// and the pages do. If Supabase Auth is slow or down, the request continues
// (degraded: the page re-checks the user and sends them to /login).
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { createLogger, errorFields } from './lib/logger';
import { TRACE_HEADER, traceIdFrom } from './lib/trace';

const AUTH_TIMEOUT_MS = 2000;

export async function proxy(request: NextRequest) {
  const traceId = traceIdFrom(request.headers);
  const forwarded = new Headers(request.headers);
  forwarded.set(TRACE_HEADER, traceId);

  let response = NextResponse.next({ request: { headers: forwarded } });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          // Pages after the proxy must see the refreshed tokens, not the used ones.
          forwarded.set('cookie', request.cookies.toString());
          response = NextResponse.next({ request: { headers: forwarded } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
          // A response that sets auth cookies must never be cached by a CDN.
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    });
    const started = Date.now();
    try {
      // getClaims verifies the JWT and refreshes an expiring session.
      await Promise.race([
        supabase.auth.getClaims(),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), AUTH_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      createLogger(traceId).warn('proxy.auth_degraded', {
        duration_ms: Date.now() - started,
        route: request.nextUrl.pathname,
        ...errorFields(err),
      });
    }
  }
  response.headers.set(TRACE_HEADER, traceId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
