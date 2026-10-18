import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { cx } from './cx.ts';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ variant = 'primary', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx('s-button', `s-button--${variant}`, className)} {...rest} />;
}

/** A link that looks like a button, for navigation (a button would submit or act). */
export function ButtonLink({
  variant = 'primary',
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonProps['variant'] }) {
  return <a className={cx('s-button', `s-button--${variant}`, className)} {...rest} />;
}
