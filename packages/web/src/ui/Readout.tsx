// Readout: one fixed-position telemetry row (LABEL ...... value unit). Grey when nominal; colour and a
// text flag only when abnormal; hatched with a dash when stale. Rows, not tiles: scan down a column.
import { cx } from '../lib/cx.ts';

export type ReadoutState = 'nominal' | 'caution' | 'warning' | 'stale';

export interface ReadoutProps {
  label: string;
  /** Pre-formatted text, or a number formatted with `decimals`. null/undefined renders the no-data dash. */
  value: number | string | null | undefined;
  unit?: string;
  decimals?: number;
  state?: ReadoutState;
  className?: string;
}

const VALUE_TONE: Record<ReadoutState, string> = {
  nominal: 'text-text',
  caution: 'text-caution',
  warning: 'text-warning',
  stale: 'text-text-dim',
};
const FLAG: Partial<Record<ReadoutState, string>> = {
  caution: 'CAUT',
  warning: 'WARN',
  stale: 'STALE',
};

export function Readout({
  label,
  value,
  unit,
  decimals = 1,
  state = 'nominal',
  className,
}: ReadoutProps) {
  const missing =
    value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));
  const text = missing ? '—' : typeof value === 'number' ? value.toFixed(decimals) : value;
  return (
    <div
      className={cx(
        'grid h-3 grid-cols-[minmax(0,1fr)_auto_3ch_auto] items-center gap-x-1 border-b border-grid px-1',
        state === 'stale' && 'hatch',
        className,
      )}
      data-state={state}
    >
      <span className="mnemonic truncate text-xs text-text-2">{label}</span>
      <span className={cx('num num-flash text-right text-sm font-bold', VALUE_TONE[state])}>
        {text}
      </span>
      <span className="truncate text-2xs text-text-dim">{unit}</span>
      <span
        className={cx(
          'mnemonic text-2xs',
          state === 'caution' && 'text-caution',
          state === 'warning' && 'text-warning',
          state === 'stale' && 'text-text-dim',
        )}
      >
        {FLAG[state] ?? ''}
      </span>
    </div>
  );
}
