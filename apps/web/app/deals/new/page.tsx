import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Card, Notice } from '@sanad/ui';
import { Shell } from '@/components/shell';
import { flagOn } from '@/lib/flags-server';
import { getSession } from '@/lib/fund';
import { NewDealForm } from './new-deal-form';

export const metadata: Metadata = { title: 'New deal' };

export default async function NewDealPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/deals/new');
  if (!session.current) redirect('/deals');
  if (!(await flagOn('app-shell', session.current.fundId))) notFound();

  return (
    <Shell session={session}>
      <h1 className="page-title">New deal</h1>
      <div className="form-column">
        {session.current.role === 'viewer' ? (
          <Notice>Viewers can see deals but not create them. Ask a partner or analyst in your fund.</Notice>
        ) : (
          <Card>
            <NewDealForm fundId={session.current.fundId} fundName={session.current.fundName} />
          </Card>
        )}
        <p>
          <a href="/deals">Back to deals</a>
        </p>
      </div>
    </Shell>
  );
}
