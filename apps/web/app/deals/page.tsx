import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Button, EmptyState } from '@sanad/ui';
import { Shell } from '@/components/shell';
import { flagOn } from '@/lib/flags-server';
import { getSession } from '@/lib/fund';

export const metadata: Metadata = { title: 'Deals' };

export default async function DealsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/deals');

  if (!session.current) {
    return (
      <main className="auth-main">
        <h1 className="page-title">No fund yet</h1>
        <p className="muted">
          Your account isn&apos;t part of a fund on Sanad yet. Ask your Sanad contact to add you, then sign in again.
        </p>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </main>
    );
  }

  if (!(await flagOn('app-shell', session.current.fundId))) notFound();

  return (
    <Shell session={session}>
      <h1 className="page-title">Deals</h1>
      <EmptyState title="No deals yet">Deal creation arrives in the next release.</EmptyState>
    </Shell>
  );
}
