import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx.ts';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Full width on phones (below 30rem): the main action of a section. */
  blockOnPhone?: boolean;
}

export function Button({ variant = 'primary', blockOnPhone, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('s-button', `s-button--${variant}`, blockOnPhone && 's-button--block-sm', className)}
      {...rest}
    />
  );
}
