import { describe, expect, it } from 'vitest';
import type { Alert } from '@orbitops/shared';
import { summarizeAlerts } from './alertSummary.ts';

function alert(over: Partial<Alert>): Alert {
  return {
    id: 'a',
    key: '1:r',
    satId: 1,
    ruleId: 'r',
    subsystem: 'EPS',
    severity: 'CAUTION',
    state: 'open',
    message: 'm',
    value: 1,
    threshold: 2,
    openedAt: 1,
    lastSeenAt: 1,
    count: 1,
    ...over,
  };
}

describe('summarizeAlerts', () => {
  it('counts unacked and acked per severity and ignores resolved alerts', () => {
    const s = summarizeAlerts([
      alert({ id: '1', severity: 'WARNING', state: 'open' }),
      alert({ id: '2', severity: 'WARNING', state: 'acked' }),
      alert({ id: '3', severity: 'CAUTION', state: 'resolved' }),
    ]);
    expect(s.severity.WARNING).toEqual({ unacked: 1, acked: 1 });
    expect(s.severity.CAUTION).toEqual({ unacked: 0, acked: 0 });
    expect(s.unackedTotal).toBe(1);
  });

  it('tracks worst severity and unacked count per subsystem', () => {
    const s = summarizeAlerts([
      alert({ id: '1', subsystem: 'TCS', severity: 'CAUTION', state: 'acked' }),
      alert({ id: '2', subsystem: 'TCS', severity: 'WARNING', state: 'acked' }),
      alert({ id: '3', subsystem: 'COMM', severity: 'CAUTION', state: 'open' }),
    ]);
    expect(s.subsystem.TCS).toEqual({ worst: 'WARNING', unacked: 0, active: 2 });
    expect(s.subsystem.COMM).toEqual({ worst: 'CAUTION', unacked: 1, active: 1 });
    expect(s.subsystem.EPS.worst).toBeNull();
  });

  it('keeps the most severe active alert per satellite', () => {
    const s = summarizeAlerts([
      alert({ id: '1', satId: 7, severity: 'CAUTION' }),
      alert({ id: '2', satId: 7, severity: 'WARNING' }),
      alert({ id: '3', satId: 8, severity: 'ADVISORY' }),
    ]);
    expect(s.worstBySat).toEqual({ 7: 'WARNING', 8: 'ADVISORY' });
  });
});
