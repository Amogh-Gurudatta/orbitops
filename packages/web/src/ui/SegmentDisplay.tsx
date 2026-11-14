// Segmented-LED style numeric readout. Digits sit over a dim "8" ghost layer so the unlit segments
// of a real display stay faintly visible. Used for UTC / MET clocks and big counters.
import { cx } from '../lib/cx.ts';

export interface SegmentDisplayProps {
  /** Text such as "12:34:56" or "014:07:30:12". Digits get ghost segments; separators do not. */
  value: string;
  /** Mnemonic caption above/before the digits, e.g. "UTC". */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE = { sm: 'text-sm', md: 'text-lg', lg: 'text-xl' } as const;

export function SegmentDisplay({ value, label, size = 'md', className }: SegmentDisplayProps) {
  const ghost = value.replace(/\d/g, '8');
  return (
    <div
      className={cx('inline-flex items-baseline gap-1', className)}
      role="timer"
      aria-label={label ? `${label} ${value}` : value}
    >
      {label && <span className="mnemonic text-xs text-text-2">{label}</span>}
      <span className={cx('num relative inline-grid font-bold', SIZE[size])}>
        <span aria-hidden="true" className="col-start-1 row-start-1 text-grid select-none">
          {ghost}
        </span>
        <span className="col-start-1 row-start-1 text-text">{value}</span>
      </span>
    </div>
  );
}
