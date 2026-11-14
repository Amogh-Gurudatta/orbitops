// Flat button: 1px border, caps label. Primary = white border; danger = red; no fills, no shadows, no scale.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  /** Keyboard hint shown at the end of the label. */
  hint?: ReactNode;
}

const VARIANT = {
  default: 'border-rule text-text hover:border-text-2',
  primary: 'border-select text-select hover:bg-select hover:text-bg',
  danger: 'border-warning text-warning hover:bg-warning hover:text-bg',
  ghost: 'border-transparent text-text-2 hover:text-text hover:border-rule',
} as const;

export function Button({
  variant = 'default',
  size = 'md',
  hint,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'mnemonic inline-flex items-center justify-center gap-1 border px-1.5 text-xs',
        size === 'sm' ? 'h-3' : 'h-4',
        'transition-colors duration-(--duration-data) ease-linear',
        'disabled:pointer-events-none disabled:border-grid disabled:text-text-dim',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {hint}
    </button>
  );
}
