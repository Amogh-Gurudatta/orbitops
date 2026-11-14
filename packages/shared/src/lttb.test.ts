import { describe, expect, it } from 'vitest';
import { lttbIndices, lttbPoints } from './lttb.js';

const series = (n: number) => {
  const xs = Array.from({ length: n }, (_, i) => i);
  const ys = xs.map((i) => Math.sin(i / 20) + (i === 500 ? 5 : 0));
  return { xs, ys };
};

describe('lttb', () => {
  it('returns exactly `threshold` ascending indices that keep first and last', () => {
    const { xs, ys } = series(2000);
    const idx = lttbIndices(xs, ys, 100);
    expect(idx).toHaveLength(100);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(1999);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(new Set(idx).size).toBe(100);
  });

  it('keeps visually significant spikes', () => {
    const { xs, ys } = series(2000);
    expect(lttbIndices(xs, ys, 100)).toContain(500);
  });

  it('returns every index when the series already fits', () => {
    expect(lttbIndices([1, 2, 3], [1, 2, 3], 10)).toEqual([0, 1, 2]);
    expect(lttbIndices([], [], 10)).toEqual([]);
  });

  it('degrades gracefully for tiny thresholds', () => {
    const { xs, ys } = series(50);
    expect(lttbIndices(xs, ys, 2)).toEqual([0, 49]);
  });

  it('works on typed arrays and point objects', () => {
    const xs = new Float64Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const ys = new Float64Array([0, 1, 0, 1, 0, 9, 0, 1, 0, 1]);
    expect(lttbIndices(xs, ys, 4)).toHaveLength(4);
    const points = Array.from(xs, (t, i) => ({ t, v: ys[i] as number }));
    const out = lttbPoints(points, 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(points[0]);
    expect(out.at(-1)).toBe(points[9]);
  });
});
