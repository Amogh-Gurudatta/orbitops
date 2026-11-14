import { describe, expect, it } from 'vitest';
import { ClockSync, LatencyWindow, quantile } from './latency.ts';

describe('quantile', () => {
  it('uses nearest rank', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(sorted, 0.5)).toBe(5);
    expect(quantile(sorted, 0.95)).toBe(10);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe('LatencyWindow', () => {
  it('reports percentiles and resets after draining', () => {
    const w = new LatencyWindow(100);
    for (let i = 1; i <= 100; i++) w.add(i);
    const report = w.drain();
    expect(report).toEqual({ p50: 50, p95: 95, p99: 99, n: 100 });
    expect(w.drain().n).toBe(0);
  });

  it('keeps only the newest samples when over capacity and ignores non-finite values', () => {
    const w = new LatencyWindow(3);
    [100, 1, 2, 3, Number.NaN].forEach((v) => w.add(v));
    expect(w.drain()).toMatchObject({ n: 3, p99: 3 });
  });
});

describe('ClockSync', () => {
  it('estimates offset from the round-trip midpoint', () => {
    const c = new ClockSync();
    // client sent at 1000, got reply at 1040 (rtt 40); server stamped 5020 -> offset 5020-1020
    c.addSample(1000, 5020, 1040);
    expect(c.offsetMs).toBe(4000);
  });

  it('prefers the sample with the smallest round trip', () => {
    const c = new ClockSync();
    c.addSample(0, 4100, 200); // rtt 200, offset 4000
    c.addSample(1000, 5010, 1020); // rtt 20, offset 4000 (precise)
    c.addSample(2000, 6500, 2400); // rtt 400, offset 4300
    expect(c.offsetMs).toBe(4000);
  });

  it('is zero before any sample', () => {
    expect(new ClockSync().offsetMs).toBe(0);
  });
});
