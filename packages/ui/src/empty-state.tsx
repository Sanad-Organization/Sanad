import type { ReactNode } from 'react';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="s-empty">
      <h2 className="s-empty__title">{title}</h2>
      {children ? <div className="s-empty__body">{children}</div> : null}
    </div>
  );
}
