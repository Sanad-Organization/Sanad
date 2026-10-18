import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Badge, Button, EmptyState, Notice, Table } from '@sanad/ui';
import { Shell } from '@/components/shell';
import type { DealStatus } from '@sanad/types';
import { roundLabel } from '@/lib/deal-form';
import { listDeals } from '@/lib/deals';
import { flagOn } from '@/lib/flags-server';
import { getSession } from '@/lib/fund';

export const metadata: Metadata = { title: 'Deals' };

const STATUS_LABEL: Record<DealStatus, string> = {
  screening: 'Screening',
  diligence: 'Diligence',
  approved: 'Approved',
  passed: 'Passed',
  portfolio: 'Portfolio',
};
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

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

  const fund = session.current;
  if (!(await flagOn('app-shell', fund.fundId))) notFound();

  const deals = await listDeals(fund.fundId);
  const canCreate = fund.role !== 'viewer';

  return (
    <Shell session={session}>
      <div className="page-head">
        <h1 className="page-title">Deals</h1>
        {canCreate ? (
          // A GET form so the action is a real Button and still works without JavaScript.
          <form action="/deals/new" method="get" className="page-action">
            <Button type="submit" blockOnPhone>
              New deal
            </Button>
          </form>
        ) : null}
      </div>
      {deals === null ? (
        <Notice tone="danger">We couldn&apos;t load your deals. Try again in a moment.</Notice>
      ) : deals.length === 0 ? (
        <EmptyState title="No deals yet">
          {canCreate ? <a href="/deals/new">Create your first deal</a> : 'Deals your fund creates will appear here.'}
        </EmptyState>
      ) : (
        <Table>
          <caption className="visually-hidden">Deals in {fund.fundName}</caption>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Round</th>
              <th scope="col">Sector</th>
              <th scope="col">Country</th>
              <th scope="col">Status</th>
              <th scope="col">Added</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id}>
                <td data-label="Company">{d.companies?.name ?? '—'}</td>
                <td data-label="Round">{roundLabel(d.round)}</td>
                <td data-label="Sector">{d.companies?.sector ?? '—'}</td>
                <td data-label="Country">{d.companies?.country ?? '—'}</td>
                <td data-label="Status">
                  <Badge>{STATUS_LABEL[d.status]}</Badge>
                </td>
                <td data-label="Added">{dateFormat.format(new Date(d.created_at))}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Shell>
  );
}
