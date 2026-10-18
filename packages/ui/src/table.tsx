import type { TableHTMLAttributes } from 'react';
import { cx } from './cx.ts';

/**
 * Responds to its own width: below 30rem each row becomes a stacked card, so give
 * every <td> a data-label with its column name. Never scrolls the page sideways.
 */
export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="s-table-wrap">
      <table className={cx('s-table', className)} {...rest} />
    </div>
  );
}
