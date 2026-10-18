// Render checks without a DOM: server-render each component and assert what a
// screen reader gets (bootstrap §12.4; an axe run comes with the E2E harness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FindingBadge } from './finding-badge.ts';
import { SourceTier } from './source-tier.ts';

const text = (html: string) =>
  html.replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/span>/g, '').replace(/<[^>]+>/g, '');

test('FindingBadge: word for readers, glyph hidden', () => {
  const html = renderToStaticMarkup(h(FindingBadge, { type: 'red_flag' }));
  assert.match(html, /aria-hidden="true">!<\/span>/);
  assert.equal(text(html), 'Red flag');
});

test('FindingBadge with a count: number shown, phrase read', () => {
  const html = renderToStaticMarkup(h(FindingBadge, { type: 'red_flag', count: 2 }));
  assert.equal(text(html), '2 red flags');
});

test('SourceTier is read as "Tier N: label"', () => {
  const html = renderToStaticMarkup(h(SourceTier, { tier: 4, label: 'Pitch deck, slide 6' }));
  assert.equal(text(html), 'Tier 4: Pitch deck, slide 6');
  assert.match(html, /s-tier--4/);
});
