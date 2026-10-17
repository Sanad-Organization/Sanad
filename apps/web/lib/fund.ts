import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { pickFund, toMemberships, type FundMembership } from './fund-select';
import { errorFields } from './logger';
import { requestLogger } from './request';
import { supabaseServer } from './supabase/server';

export const FUND_COOKIE = 'sanad_fund';
export type { FundMembership };

export interface Session {
  userId: string;
  funds: FundMembership[];
  current: FundMembership | null;
}

/** The signed-in user, their funds (RLS returns only their own) and the fund they work in. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from('memberships')
    .select('fund_id, role, funds(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) {
    (await requestLogger()).error('session.memberships_failed', { user_id: user.id, ...errorFields(error) });
    throw Object.assign(new Error('memberships query failed'), { code: error.code });
  }
  const funds = toMemberships(data ?? []);
  const current = pickFund(funds, (await cookies()).get(FUND_COOKIE)?.value);
  return { userId: user.id, funds, current };
});
