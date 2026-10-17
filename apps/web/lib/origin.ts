// The origin the user is actually browsing (production domain, branch alias or
// localhost). Auth cookies (PKCE verifier, session) live on that host, so
// sign-in links must come back to it. Supabase only redirects to URLs on its
// allow-list, so a forged Host header can't send a link elsewhere.
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

export function originFrom(headers: { get(name: string): string | null }, fallback: string): string {
  const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0]!.trim();
  if (!HOST.test(host)) return fallback;
  const proto = (headers.get('x-forwarded-proto') ?? '').split(',')[0]!.trim();
  const scheme = proto === 'http' && /^localhost(:\d+)?$/.test(host) ? 'http' : 'https';
  return `${scheme}://${host}`;
}
