// Written with createElement (no JSX) so node --test can render it directly.
import { createElement as h, Fragment } from 'react';
import { FINDINGS, countLabel, type FindingType } from './findings.ts';

/**
 * The type of a finding. Word, glyph and colour always travel together, so the
 * meaning never depends on colour. With `count`, the badge shows the number and
 * keeps the full phrase ("3 red flags") for screen readers.
 */
export function FindingBadge({ type, count }: { type: FindingType; count?: number }) {
  const f = FINDINGS[type];
  const body =
    count === undefined
      ? f.word
      : h(
          Fragment,
          null,
          h('span', { 'aria-hidden': 'true' }, count),
          h('span', { className: 'visually-hidden' }, countLabel(type, count)),
        );
  return h(
    'span',
    { className: `s-badge s-badge--${f.cls}` },
    h('span', { className: 's-badge__glyph', 'aria-hidden': 'true' }, f.glyph),
    body,
  );
}
