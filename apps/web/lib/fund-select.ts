// Pure fund selection, kept apart from Next so it is unit-tested.
import type { MemberRole } from '@sanad/types';

export interface FundMembership {
  fundId: string;
  fundName: string;
  role: MemberRole;
}

const ROLES = new Set<string>(['owner', 'partner', 'analyst', 'viewer']);

/** Rows the database returned → memberships. Rows with an unknown role are dropped. */
export function toMemberships(rows: ReadonlyArray<{ fund_id: string; role: string; funds: { name: string } | null }>) {
  return rows
    .filter((r) => ROLES.has(r.role))
    .map((r): FundMembership => ({ fundId: r.fund_id, fundName: r.funds?.name ?? 'Fund', role: r.role as MemberRole }));
}

/**
 * The cookie only *selects* among funds the database returned for this user;
 * a cookie naming any other fund is ignored.
 */
export function pickFund(funds: readonly FundMembership[], cookie: string | undefined): FundMembership | null {
  return funds.find((f) => f.fundId === cookie) ?? funds[0] ?? null;
}

export function mayUseFund(funds: readonly FundMembership[], wanted: unknown): wanted is string {
  return typeof wanted === 'string' && funds.some((f) => f.fundId === wanted);
}
