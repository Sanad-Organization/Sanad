import type { HTMLAttributes } from 'react';
import { cx } from './cx.ts';

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx('s-card', className)} {...rest} />;
}
