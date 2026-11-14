// Rolls a list of alerts up into the counts the annunciators need. Pure and unit-tested.
import {
  SEVERITIES,
  SUBSYSTEMS,
  type Alert,
  type Severity,
  type Subsystem,
} from '@orbitops/shared';

export interface SubsystemSummary {
  /** Most severe active alert, regardless of acknowledgement. Drives lamp colour. */
  worst: Severity | null;
  /** Active alerts nobody has acknowledged yet. Drives flashing. */
  unacked: number;
  active: number;
}

export interface AlertSummary {
  severity: Record<Severity, { unacked: number; acked: number }>;
  subsystem: Record<Subsystem, SubsystemSummary>;
  /** Most severe active alert per satellite. */
  worstBySat: Record<number, Severity>;
  unackedTotal: number;
}

const RANK: Record<Severity, number> = { WARNING: 3, CAUTION: 2, ADVISORY: 1 };

export function moreSevere(a: Severity | null, b: Severity): Severity {
  return a === null || RANK[b] > RANK[a] ? b : a;
}

export function summarizeAlerts(alerts: readonly Alert[]): AlertSummary {
  const severity = Object.fromEntries(
    SEVERITIES.map((s) => [s, { unacked: 0, acked: 0 }]),
  ) as AlertSummary['severity'];
  const subsystem = Object.fromEntries(
    SUBSYSTEMS.map((s) => [s, { worst: null, unacked: 0, active: 0 }]),
  ) as AlertSummary['subsystem'];
  const worstBySat: Record<number, Severity> = {};
  let unackedTotal = 0;

  for (const alert of alerts) {
    if (alert.state === 'resolved') continue;
    const unacked = alert.state === 'open';
    severity[alert.severity][unacked ? 'unacked' : 'acked']++;
    const sub = subsystem[alert.subsystem];
    sub.active++;
    sub.worst = moreSevere(sub.worst, alert.severity);
    if (unacked) {
      sub.unacked++;
      unackedTotal++;
    }
    worstBySat[alert.satId] = moreSevere(worstBySat[alert.satId] ?? null, alert.severity);
  }
  return { severity, subsystem, worstBySat, unackedTotal };
}
