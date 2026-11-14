// Severity chip for the alarm list. While the alarm is unacknowledged a filled layer flashes at 1 Hz
// over the outlined chip (same two-layer scheme as the annunciator lamps); once acknowledged it is steady.
import type { Severity } from '@orbitops/shared';
import { cx } from '../../lib/cx.ts';

const CODE: Record<Severity, string> = { WARNING: 'WARN', CAUTION: 'CAUT', ADVISORY: 'ADV' };
const OUTLINE: Record<Severity, string> = {
  WARNING: 'border-warning text-warning',
  CAUTION: 'border-caution text-caution',
  ADVISORY: 'border-advisory text-advisory',
};
const FILL: Record<Severity, string> = {
  WARNING: 'bg-warning',
  CAUTION: 'bg-caution',
  ADVISORY: 'bg-advisory',
};

export function SevChip({
  severity,
  flashing,
  muted,
}: {
  severity: Severity;
  /** Open and unacknowledged. */
  flashing?: boolean;
  /** Resolved alarms lose their colour (colour is reserved for live state). */
  muted?: boolean;
}) {
  return (
    <span
      data-unacked={flashing || undefined}
      className={cx(
        'mnemonic relative inline-flex h-2 w-5 items-center justify-center border text-2xs',
        muted ? 'border-rule text-text-dim' : OUTLINE[severity],
        flashing && 'flash-1hz-inverse',
      )}
    >
      {CODE[severity]}
      {flashing && (
        <span
          aria-hidden="true"
          className={cx(
            'flash-1hz absolute -inset-px flex items-center justify-center text-bg',
            FILL[severity],
          )}
        >
          {CODE[severity]}
        </span>
      )}
    </span>
  );
}
