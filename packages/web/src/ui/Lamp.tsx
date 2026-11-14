// Annunciator lamp (cockpit master caution / subsystem strip). Dark when clear; filled amber/red when
// active; flashes at 1 Hz in hard steps while unacknowledged, then goes steady once acknowledged.
import type { Severity } from '@orbitops/shared';
import { cx } from '../lib/cx.ts';

export interface LampProps {
  label: string;
  /** Colour of the lit lamp; null/undefined = off. */
  severity?: Severity | null;
  /** True while the cause is unacknowledged: the lamp flashes. */
  unacked?: boolean;
  /** Small count shown after the label. */
  count?: number;
  onClick?: () => void;
  /** Accessible description, e.g. "3 unacknowledged warnings". */
  title?: string;
  className?: string;
}

const FILL: Record<Severity, string> = {
  WARNING: 'bg-warning',
  CAUTION: 'bg-caution',
  ADVISORY: 'bg-advisory',
};
const TEXT: Record<Severity, string> = {
  WARNING: 'text-warning',
  CAUTION: 'text-caution',
  ADVISORY: 'text-advisory',
};
const BORDER: Record<Severity, string> = {
  WARNING: 'border-warning',
  CAUTION: 'border-caution',
  ADVISORY: 'border-advisory',
};

export function Lamp({ label, severity, unacked, count, onClick, title, className }: LampProps) {
  const lit = severity != null;
  const text = count !== undefined && count > 0 ? `${label} ${count}` : label;
  const body = (
    <>
      {/* Base layer: the "dark window" with coloured legend, visible when the lamp is off or mid-flash. */}
      <span
        className={cx(
          'mnemonic relative block px-1 text-xs leading-[22px]',
          lit ? TEXT[severity] : 'text-text-dim',
          lit && unacked && 'flash-1hz-inverse',
        )}
      >
        {text}
      </span>
      {/* Lit layer: solid fill with dark legend. Flashes on/off while unacknowledged. */}
      {lit && (
        <span
          aria-hidden="true"
          className={cx(
            'mnemonic absolute inset-0 block px-1 text-xs leading-[22px] text-bg',
            FILL[severity],
            unacked && 'flash-1hz',
          )}
        >
          {text}
        </span>
      )}
    </>
  );
  const classes = cx(
    'relative inline-block h-3 min-w-6 shrink-0 border bg-bg text-center',
    lit ? BORDER[severity] : 'border-rule',
    onClick && 'cursor-pointer',
    className,
  );
  const state = lit ? `${severity}${unacked ? ' unacknowledged' : ' acknowledged'}` : 'clear';
  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      title={title}
      data-unacked={lit && unacked}
      aria-label={`${label} ${state}${title ? ` — ${title}` : ''}`}
    >
      {body}
    </button>
  ) : (
    <span
      className={classes}
      title={title}
      data-unacked={lit && unacked}
      role="status"
      aria-label={`${label} ${state}`}
    >
      {body}
    </span>
  );
}
