// Every feature flag Sanad evaluates. Server-side only; anything but an explicit
// `true` from the flag service means OFF (bootstrap §11.4, docs/runbooks/flags.md).
// Each flag has an owner, a purpose and an expiry; stale flags are removed at
// each phase boundary.

export interface FlagSpec {
  readonly purpose: string;
  readonly owner: 'owner';
  /** ISO date by which the flag is removed or made permanent. */
  readonly expires: string;
  /** Inverse flags pause something when ON. */
  readonly inverse?: true;
}

export const FLAGS = {
  'app-shell': { purpose: 'Signed-in app, deals list, new deal', owner: 'owner', expires: '2027-01-31' },
  'collect-web': { purpose: 'Website, news, files, outside-in check', owner: 'owner', expires: '2027-01-31' },
  'github-scan': { purpose: 'Access link, GitHub App, scan sandbox', owner: 'owner', expires: '2027-01-31' },
  'social-overview': {
    purpose: 'Profile discovery, social collection and analysis',
    owner: 'owner',
    expires: '2027-01-31',
  },
  'deal-room': { purpose: 'Deal room tabs, claims, scores, approvals', owner: 'owner', expires: '2027-01-31' },
  agent: { purpose: 'Agent tab and endpoint', owner: 'owner', expires: '2027-01-31' },
  'verdict-pdf': { purpose: 'One-page verdict export', owner: 'owner', expires: '2027-01-31' },
  'worker-kill': {
    purpose: 'Pause all job claiming (kill switch)',
    owner: 'owner',
    expires: '2099-12-31',
    inverse: true,
  },
} as const satisfies Record<string, FlagSpec>;

export type FlagKey = keyof typeof FLAGS;

/** The only way to read a flag value: explicit `true` is on, everything else is off. */
export function isOn(value: unknown): boolean {
  return value === true;
}
