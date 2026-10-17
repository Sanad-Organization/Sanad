// The only environment variables apps/web may read. boundary.test.ts fails the
// build if code reads any other (so a service-role key can never be wired in).
export const WEB_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'POSTHOG_HOST',
  'POSTHOG_PROJECT_KEY',
  'SENTRY_DSN',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'NODE_ENV',
] as const;

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

// NEXT_PUBLIC_* must be read with literal property access to be inlined at build.
export const supabaseUrl = () => requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
export const supabaseAnonKey = () =>
  requireEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

/** Used only when the request carries no usable host (see lib/origin.ts). */
export function fallbackOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  return explicit ? explicit.replace(/\/$/, '') : 'http://localhost:3000';
}
