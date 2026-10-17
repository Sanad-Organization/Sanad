import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { MemberRole } from '@sanad/types';
import { supabaseServer } from './supabase/server';

export const FUND_COOKIE = 'sanad_fund';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export interface FundMembership {
  fundId: string;
  fundName: string;
  role: MemberRole;
}

export interface Session {
  userId: string;
  funds: FundMembership[];
  current: FundMembership | null;
}

/**
 * The signed-in user, their funds (RLS returns only their own memberships'
 * funds) and the fund they are working in. The cookie only *selects* among
 * funds the database already returned; it never grants access.
 */
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
  if (error) throw Object.assign(new Error('memberships query failed'), { code: error.code });

  const funds: FundMembership[] = (data ?? []).map((m) => ({
    fundId: m.fund_id,
    fundName: m.funds?.name ?? 'Fund',
    role: m.role as MemberRole,
  }));
  const wanted = (await cookies()).get(FUND_COOKIE)?.value;
  const current = funds.find((f) => f.fundId === wanted) ?? funds[0] ?? null;
  return { userId: user.id, funds, current };
});
