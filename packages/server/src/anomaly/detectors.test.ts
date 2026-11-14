import type { AlertRule } from '@orbitops/shared';
import { describe, expect, it } from 'vitest';
import {
  Hysteresis,
  Limit,
  createRocDetector,
  createThresholdDetector,
  createZScoreDetector,
} from './detectors.js';
import { frame } from './testFrames.js';

const rule = (overrides: Partial<AlertRule>): AlertRule => ({
  id: 't.rule',
  name: 'Test rule',
  subsystem: 'EPS',
  severity: 'CAUTION',
  kind: 'threshold',
  metric: 'panelTempC',
  op: '>',
  threshold: 70,
  enabled: true,
  ...overrides,
});

describe('Limit', () => {
  it('puts the clear point inside the threshold by (1 - clearRatio)', () => {
    const upper = new Limit('>', 70, 0.9);
    expect(upper.breached(70.1)).toBe(true);
    expect(upper.breached(70)).toBe(false);
    expect(upper.cleared(63)).toBe(true);
    expect(upper.cleared(64)).toBe(false);

    const lower = new Limit('<', 0.2, 0.9);
    expect(lower.breached(0.19)).toBe(true);
    expect(lower.cleared(0.22)).toBe(true);
    expect(lower.cleared(0.21)).toBe(false);
  });

  it('works for negative thresholds', () => {
    const falling = new Limit('<', -0.002, 0.9);
    expect(falling.breached(-0.003)).toBe(true);
    expect(falling.cleared(-0.0018)).toBe(true);
    expect(falling.cleared(-0.0019)).toBe(false);
  });
});

describe('Hysteresis', () => {
  const breach = { breach: true, clear: false, value: 1, limit: 0 };
  const clear = { breach: false, clear: true, value: 1, limit: 0 };
  const band = { breach: false, clear: false, value: 1, limit: 0 };

  it('opens only after N consecutive breaches', () => {
    const h = new Hysteresis(3);
    expect(h.step(breach, true)).toBeNull();
    expect(h.step(breach, true)).toBeNull();
    expect(h.step(clear, true)).toBeNull(); // streak broken
    expect(h.step(breach, true)).toBeNull();
    expect(h.step(breach, true)).toBeNull();
    expect(h.step(breach, true)).toBe('open');
  });

  it('closes only after N consecutive clear samples; the band holds the alert open', () => {
    const h = new Hysteresis(3, true);
    expect(h.step(clear, true)).toBeNull();
    expect(h.step(clear, true)).toBeNull();
    expect(h.step(band, true)).toBeNull(); // streak broken
    expect(h.step(clear, true)).toBeNull();
    expect(h.step(clear, true)).toBeNull();
    expect(h.step(clear, true)).toBe('close');
  });

  it('opens on the first allowed sample after being deferred', () => {
    const h = new Hysteresis(2);
    h.step(breach, false);
    h.step(breach, false);
    h.step(breach, false);
    expect(h.step(breach, true)).toBe('open');
  });
});

describe('threshold detector', () => {
  it('flags breach / clear and skips null metrics', () => {
    const detector = createThresholdDetector(rule({ metric: 'rssiDbm', op: '<', threshold: -120 }));
    expect(detector.observe(frame({ rssiDbm: null }), 0)).toBeNull();
    expect(detector.observe(frame({ rssiDbm: -130 }), 0)).toMatchObject({
      breach: true,
      clear: false,
    });
    expect(detector.observe(frame({ rssiDbm: -100 }), 0)).toMatchObject({
      breach: false,
      clear: true,
    });
  });
});

describe('z-score detector', () => {
  const zrule = rule({ kind: 'zscore', metric: 'busA', threshold: 4, windowSize: 20 });

  it('stays silent during warm-up, then flags outliers in either direction', () => {
    const detector = createZScoreDetector(zrule);
    for (let i = 0; i < 20; i++) {
      expect(detector.observe(frame({ busA: 1.5 + (i % 2) * 0.1 }), i)).toBeNull();
    }
    expect(detector.observe(frame({ busA: 1.55 }), 20)).toMatchObject({ breach: false });
    expect(detector.observe(frame({ busA: 5 }), 21)).toMatchObject({ breach: true });
    const low = createZScoreDetector(zrule);
    for (let i = 0; i < 20; i++) low.observe(frame({ busA: 1.5 + (i % 2) * 0.1 }), i);
    expect(low.observe(frame({ busA: -3 }), 20)).toMatchObject({ breach: true });
  });
});

describe('rate-of-change detector', () => {
  const rrule = rule({ kind: 'roc', metric: 'batSoc', op: '<', threshold: -0.002, windowSize: 5 });

  it('flags a fall faster than the threshold per second, not a slow one', () => {
    const slow = createRocDetector(rrule);
    for (let i = 0; i < 20; i++) {
      const d = slow.observe(frame({ batSoc: 0.8 - i * 0.0001 }), i * 1000); // -0.0001/s
      if (d) expect(d.breach).toBe(false);
    }
    const fast = createRocDetector(rrule);
    let last = null;
    for (let i = 0; i < 20; i++) last = fast.observe(frame({ batSoc: 0.8 - i * 0.005 }), i * 1000); // -0.005/s
    expect(last).toMatchObject({ breach: true });
    expect(last?.value).toBeCloseTo(-0.005, 9);
  });
});
