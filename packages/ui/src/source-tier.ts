// Written with createElement (no JSX) so node --test can render it directly.
import { createElement as h } from 'react';
import type { Tier } from './findings.ts';

/**
 * How much weight a citation carries: 1 = Sanad's own measurement (blue) …
 * 4 = the founder's claim (amber). Shown beside every source, Tier 4 included.
 */
export function SourceTier({ tier, label }: { tier: Tier; label: string }) {
  return h(
    'span',
    { className: `s-tier s-tier--${tier}` },
    h('span', { className: 's-tier__n', 'aria-hidden': 'true' }, `T${tier}`),
    h('span', { className: 'visually-hidden' }, `Tier ${tier}: `),
    h('span', { className: 's-tier__label' }, label),
  );
}
