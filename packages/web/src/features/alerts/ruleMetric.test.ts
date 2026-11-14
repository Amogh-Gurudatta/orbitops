import { describe, expect, it } from 'vitest';
import { makeAlert } from './alertFixtures.ts';
import { alertWindow, CONTEXT_PAD_MS, metricForRule } from './ruleMetric.ts';

describe('metricForRule', () => {
  it('maps the default rules', () => {
    expect(metricForRule('tcs.panelOverTemp', 'TCS')).toBe('panelTempC');
    expect(metricForRule('tcs.obcOverTemp', 'TCS')).toBe('obcTempC');
    expect(metricForRule('eps.socDropRate', 'EPS')).toBe('batSoc');
    expect(metricForRule('adcs.tumble', 'ADCS')).toBe('attRateDps');
    expect(metricForRule('comm.linkLossInPass', 'COMM')).toBe('rssiDbm');
  });

  it('falls back to the subsystem headline metric, and null for stale telemetry', () => {
    expect(metricForRule('tcs.somethingNew', 'TCS')).toBe('panelTempC');
    expect(metricForRule('obc.stale', 'OBC')).toBeNull();
    expect(metricForRule('obc.other', 'OBC')).toBeNull();
  });
});

describe('alertWindow', () => {
  it('pads the alert lifetime and never reaches into the future', () => {
    const alert = makeAlert({ id: 'a', openedAt: 10_000_000, lastSeenAt: 10_500_000 });
    const window = alertWindow(alert, 100_000_000);
    expect(window.from).toBe(10_000_000 - CONTEXT_PAD_MS);
    expect(window.to).toBe(10_500_000 + CONTEXT_PAD_MS);
    expect(alertWindow(alert, 10_600_000).to).toBe(10_600_000);
  });

  it('ends at resolution for resolved alerts', () => {
    const alert = makeAlert({
      id: 'a',
      state: 'resolved',
      openedAt: 1_000_000,
      lastSeenAt: 2_000_000,
      resolvedAt: 3_000_000,
    });
    expect(alertWindow(alert, 1e12).to).toBe(3_000_000 + CONTEXT_PAD_MS);
  });
});
