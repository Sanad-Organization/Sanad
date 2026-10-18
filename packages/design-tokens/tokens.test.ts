// The contrast promises in tokens.css, checked (bootstrap §12.2): every text/ground
// pair the design system names meets WCAG AA in both themes; focus and control
// edges meet 3:1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function colours(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
const darkBlock = css.slice(
  css.indexOf('@media (prefers-color-scheme: dark)'),
  css.indexOf('@media (prefers-reduced-motion'),
);
const light = colours(lightBlock);
const dark = { ...light, ...colours(darkBlock) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-sunken'],
  ['text', 'accent-soft'],
  ['text', 'verified-bg'],
  ['text', 'warning-bg'],
  ['text', 'danger-bg'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'surface-sunken'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent', 'accent-soft'],
  ['on-accent', 'accent'],
  ['verified', 'surface'],
  ['verified', 'verified-bg'],
  ['warning', 'surface'],
  ['warning', 'warning-bg'],
  ['danger', 'surface'],
  ['danger', 'danger-bg'],
];
const EDGE_PAIRS: Array<[string, string]> = [
  ['focus', 'bg'],
  ['focus', 'surface'],
  ['border-strong', 'bg'],
  ['border-strong', 'surface'],
];

for (const [name, theme] of [
  ['light', light],
  ['dark', dark],
] as const) {
  test(`${name}: every token the pairs use is defined`, () => {
    for (const [a, b] of [...TEXT_PAIRS, ...EDGE_PAIRS]) {
      assert.ok(theme[a] && theme[b], `${a} or ${b} missing`);
    }
  });
  test(`${name}: text pairs meet 4.5:1`, () => {
    for (const [a, b] of TEXT_PAIRS) {
      const r = ratio(theme[a]!, theme[b]!);
      assert.ok(r >= 4.5, `${a} on ${b}: ${r.toFixed(2)}`);
    }
  });
  test(`${name}: focus and control edges meet 3:1`, () => {
    for (const [a, b] of EDGE_PAIRS) {
      const r = ratio(theme[a]!, theme[b]!);
      assert.ok(r >= 3, `${a} on ${b}: ${r.toFixed(2)}`);
    }
  });
}
