// Text-code chips. Colour only for abnormal state; STALE is hatched. Always carries a text code so
// state is never conveyed by colour alone.
import type { ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import type { SatStatus } from '../realtime/status.ts';

export type TagTone = 'neutral' | 'caution' | 'warning' | 'advisory' | 'predicted' | 'stale';

const TONE: Record<TagTone, string> = {
  neutral: 'border-rule text-text-2',
  caution: 'border-caution text-caution',
  warning: 'border-warning text-warning',
  advisory: 'border-advisory text-advisory',
  predicted: 'border-predicted text-predicted',
  stale: 'border-rule text-text-dim hatch',
};

export function Tag({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: TagTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'mnemonic inline-flex h-2 items-center border px-0.5 text-2xs',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<SatStatus, TagTone> = {
  NOM: 'neutral',
  CAUT: 'caution',
  WARN: 'warning',
  STALE: 'stale',
};

/** NOM / CAUT / WARN / STALE status code. */
export function StatusChip({ status, className }: { status: SatStatus; className?: string }) {
  return (
    <Tag tone={STATUS_TONE[status]} className={className}>
      {status}
    </Tag>
  );
}

const SEVERITY_TONE = { WARNING: 'warning', CAUTION: 'caution', ADVISORY: 'advisory' } as const;

export function SeverityChip({
  severity,
  className,
}: {
  severity: keyof typeof SEVERITY_TONE;
  className?: string;
}) {
  return (
    <Tag tone={SEVERITY_TONE[severity]} className={className}>
      {severity === 'WARNING' ? 'WARN' : severity === 'CAUTION' ? 'CAUT' : 'ADV'}
    </Tag>
  );
}
