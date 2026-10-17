import type { ReactNode } from 'react';

/** role=alert for errors so they are announced; status for everything else. */
export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'danger' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`s-notice s-notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
