import type { TableHTMLAttributes } from 'react';
import { cx } from './cx.ts';

/** Wrap in a scroll container so wide tables never scroll the page sideways. */
export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="s-table-wrap">
      <table className={cx('s-table', className)} {...rest} />
    </div>
  );
}
