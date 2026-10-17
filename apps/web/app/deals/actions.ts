'use server';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { flagOn } from '@/lib/flags-server';
import { FUND_COOKIE, getSession } from '@/lib/fund';
import { mayUseFund } from '@/lib/fund-select';
import { startAction } from '@/lib/request';

/** Switch the working fund. Accepted only if the database lists the user as a member. */
export async function switchFund(form: FormData) {
  const act = await startAction('fund.switch');
  const wanted = form.get('fund');
  const session = await getSession();
  if (!session) {
    act.end('no_session');
    redirect('/login');
  }
  if (!mayUseFund(session.funds, wanted)) {
    act.end('refused', { user_id: session.userId }, 'warn');
    redirect('/deals');
  }
  if (!(await flagOn('app-shell', wanted))) {
    act.end('feature_off', { fund_id: wanted });
    notFound();
  }
  (await cookies()).set(FUND_COOKIE, wanted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
  act.end('ok', { fund_id: wanted, user_id: session.userId });
  redirect('/deals');
}
