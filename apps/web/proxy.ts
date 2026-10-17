// Runs before every page request: stamps the trace id and refreshes the
// Supabase session cookie (the user's JWT). It does not decide access; RLS
// and the pages do.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { TRACE_HEADER, traceIdFrom } from './lib/trace';

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
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: forwarded } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    // Refreshes an expiring session; the result is re-checked by each page.
    await supabase.auth.getUser();
  }
  response.headers.set(TRACE_HEADER, traceId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
