// Maps an alert to the telemetry metric worth plotting beside it, and the time window to plot.
import type { Alert, Subsystem } from '@orbitops/shared';
import type { NumericMetric } from '../../realtime/metrics.ts';

const RULE_METRICS: Record<string, NumericMetric> = {
  'eps.lowSocEclipse': 'batSoc',
  'eps.socCritical': 'batSoc',
  'eps.socDropRate': 'batSoc',
  'eps.busCurrentAnomaly': 'busA',
  'tcs.panelOverTemp': 'panelTempC',
  'tcs.panelOverTempCritical': 'panelTempC',
  'tcs.obcOverTemp': 'obcTempC',
  'comm.linkLossInPass': 'rssiDbm',
  'adcs.tumble': 'attRateDps',
};

/** Fallback when a rule was added later: the subsystem's headline metric. */
const SUBSYSTEM_METRICS: Partial<Record<Subsystem, NumericMetric>> = {
  EPS: 'batSoc',
  TCS: 'panelTempC',
  COMM: 'rssiDbm',
  ADCS: 'attRateDps',
  PROP: 'propKg',
};

/** `null` for rules without a plottable metric (e.g. the stale-telemetry rule on OBC). */
export function metricForRule(ruleId: string, subsystem: Subsystem): NumericMetric | null {
  if (ruleId === 'obc.stale') return null;
  return RULE_METRICS[ruleId] ?? SUBSYSTEM_METRICS[subsystem] ?? null;
}

export const CONTEXT_PAD_MS = 15 * 60_000;

export interface ContextWindow {
  from: number;
  to: number;
}

/** The alert's lifetime padded either side, never reaching into the future. */
export function alertWindow(alert: Alert, now: number): ContextWindow {
  const end = alert.resolvedAt ?? Math.max(alert.lastSeenAt, alert.openedAt);
  const to = Math.min(now, end + CONTEXT_PAD_MS);
  const from = alert.openedAt - CONTEXT_PAD_MS;
  return { from, to: Math.max(to, from + 60_000) };
}
