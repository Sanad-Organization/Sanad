import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx.ts';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ variant = 'primary', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx('s-button', `s-button--${variant}`, className)} {...rest} />;
}
