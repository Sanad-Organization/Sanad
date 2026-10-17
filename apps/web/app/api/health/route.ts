// Liveness for smoke tests and uptime checks. Not flag-gated, no database or
// flag call: it must stay 200 when a dependency is down.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local', env: process.env.VERCEL_ENV ?? 'local' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
