// Dense table primitives: 24px rows, sticky condensed-caps header, right-aligned tabular numbers.
// For very long lists, pair `TR`/`TD` with @tanstack/react-virtual using ROW_HEIGHT.
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

export const ROW_HEIGHT = 24;

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cx('w-full border-collapse text-left text-sm', className)} {...rest}>
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

interface TRProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Row text tone for abnormal state. */
  state?: 'caution' | 'warning' | 'stale';
  selected?: boolean;
}

export function TR({ state, selected, className, children, ...rest }: TRProps) {
  return (
    <tr
      aria-selected={selected}
      className={cx(
        'h-3 border-b border-grid',
        state === 'caution' && 'text-caution',
        state === 'warning' && 'text-warning',
        state === 'stale' && 'hatch text-text-dim',
        selected && 'outline outline-1 -outline-offset-1 outline-select',
        rest.onClick && 'cursor-pointer hover:bg-grid',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

interface CellProps {
  /** Right-align with tabular figures. */
  numeric?: boolean;
}

export function TH({
  numeric,
  className,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope="col"
      className={cx(
        'mnemonic sticky top-0 z-1 h-3 border-b border-rule bg-panel px-1 text-xs font-semibold text-text-2',
        numeric && 'text-right',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({
  numeric,
  className,
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td className={cx('h-3 truncate px-1', numeric && 'num text-right', className)} {...rest}>
      {children}
    </td>
  );
}
