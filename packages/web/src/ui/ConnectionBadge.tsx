// Link status badge: LIVE / RECONNECTING / OFFLINE / REPLAY. LIVE is plain grey (normal = no colour);
// RECONNECTING flashes amber; OFFLINE is red; REPLAY is magenta (commanded/non-live data).
import { cx } from '../lib/cx.ts';
import type { ConnectionInfo } from '../realtime/useRealtime.ts';

const STYLE: Record<ConnectionInfo['label'], string> = {
  LIVE: 'border-rule text-text-2',
  RECONNECTING: 'border-caution text-caution blink-1hz',
  OFFLINE: 'border-warning text-warning',
  REPLAY: 'border-predicted text-predicted',
};

export function ConnectionBadge({
  label,
  className,
}: {
  label: ConnectionInfo['label'];
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={`Link ${label}`}
      className={cx(
        'mnemonic inline-flex h-3 items-center border px-1 text-xs',
        STYLE[label],
        className,
      )}
    >
      {label}
    </span>
  );
}
