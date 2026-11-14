// One-line fleet alarm summary: "OPEN 12 · UNACK 5 · WARNING 2 · CAUTION 7 · ADVISORY 3".
// Counts come from the same store as the console-bar lamps, so the two never disagree.
import { SEVERITIES } from '@orbitops/shared';
import { cx } from '../../lib/cx.ts';
import { useAlertsStore } from '../../realtime/alertsStore.ts';

const TONE = {
  WARNING: 'text-warning',
  CAUTION: 'text-caution',
  ADVISORY: 'text-advisory',
} as const;

function Item({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-text-2">{label} </span>
      <span className={cx('num font-bold', value > 0 && tone ? tone : 'text-text')}>{value}</span>
    </span>
  );
}

export function AlertSummaryLine() {
  const summary = useAlertsStore((s) => s.summary);
  const active = SEVERITIES.reduce(
    (sum, sev) => sum + summary.severity[sev].unacked + summary.severity[sev].acked,
    0,
  );
  return (
    <p className="mnemonic flex flex-wrap items-center gap-x-1 text-sm" aria-label="Alarm summary">
      <Item label="OPEN" value={active} />
      <span className="text-text-dim">·</span>
      <Item label="UNACK" value={summary.unackedTotal} />
      {SEVERITIES.map((sev) => (
        <span key={sev} className="flex gap-1">
          <span className="text-text-dim">·</span>
          <Item
            label={sev}
            value={summary.severity[sev].unacked + summary.severity[sev].acked}
            tone={TONE[sev]}
          />
        </span>
      ))}
    </p>
  );
}
