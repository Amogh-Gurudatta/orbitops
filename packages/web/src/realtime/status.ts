// Satellite status classification (NOM / CAUT / WARN / STALE) from alert severity and data freshness.
import type { Severity } from '@orbitops/shared';

export type SatStatus = 'NOM' | 'CAUT' | 'WARN' | 'STALE';

export interface StatusInput {
  /** Wall-clock ms when the last frame for this satellite arrived; undefined if none yet. */
  lastSeenAt: number | undefined;
  now: number;
  /** Most severe active (unresolved) alert on this satellite. */
  worstSeverity: Severity | null;
  staleAfterMs: number;
}

/**
 * STALE wins: a satellite that stopped reporting cannot be trusted to be nominal or even abnormal.
 * Satellites never seen yet are not stale (the fleet may simply not be subscribed).
 */
export function classifyStatus(input: StatusInput): SatStatus {
  const { lastSeenAt, now, worstSeverity, staleAfterMs } = input;
  if (lastSeenAt !== undefined && now - lastSeenAt > staleAfterMs) return 'STALE';
  if (worstSeverity === 'WARNING') return 'WARN';
  if (worstSeverity === 'CAUTION') return 'CAUT';
  return 'NOM';
}

/** Maps the REST catalogue status onto the client classification. */
export function fromServerStatus(status: 'NOMINAL' | 'CAUTION' | 'WARNING' | 'STALE'): SatStatus {
  switch (status) {
    case 'WARNING':
      return 'WARN';
    case 'CAUTION':
      return 'CAUT';
    case 'STALE':
      return 'STALE';
    default:
      return 'NOM';
  }
}
