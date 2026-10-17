'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FUND_COOKIE, getSession, isUuid } from '@/lib/fund';
import { requestLogger } from '@/lib/request';

/** Switch the working fund. Accepted only if the database lists the user as a member. */
export async function switchFund(form: FormData) {
  const log = await requestLogger();
  const wanted = form.get('fund');
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isUuid(wanted) || !session.funds.some((f) => f.fundId === wanted)) {
    log.warn('action.end', { action: 'fund.switch', outcome: 'refused', user_id: session.userId });
    redirect('/deals');
  }
  (await cookies()).set(FUND_COOKIE, wanted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
  log.info('action.end', { action: 'fund.switch', outcome: 'ok', fund_id: wanted, user_id: session.userId });
  redirect('/deals');
}
