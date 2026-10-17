import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'danger';

/** Tone is never the only signal: the text says the state. */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`s-badge s-badge--${tone}`}>{children}</span>;
}
