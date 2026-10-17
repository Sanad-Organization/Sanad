import type { Metadata } from 'next';
import { Button, Card, Notice } from '@sanad/ui';
import { safeNextPath } from '@/lib/redirect';
import { signInWithGoogle } from './actions';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  link: 'That sign-in link has expired or was already used. Request a new one.',
  google: 'Google sign-in isn’t available right now. Use an email link instead.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === 'string' ? sp.next : null);
  const error = typeof sp.error === 'string' ? ERRORS[sp.error] : undefined;
  return (
    <main className="auth-main">
      <h1 className="page-title">Sign in to Sanad</h1>
      <Card>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <LoginForm next={next} />
        <p className="auth-divider">or</p>
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="secondary" className="full-width">
            Continue with Google
          </Button>
        </form>
      </Card>
    </main>
  );
}
