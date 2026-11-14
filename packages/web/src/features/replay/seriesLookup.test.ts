import { describe, expect, it } from 'vitest';
import {
  buildChartWindow,
  indexAtOrBefore,
  lowerBound,
  valueAt,
  windowIndices,
} from './seriesLookup.ts';

const t = [10, 20, 30, 40, 50];
const v = [1, 2, NaN, 4, 5];

describe('valueAt', () => {
  it('returns the sample-and-hold value at or before the time', () => {
    expect(valueAt(t, v, 20)).toBe(2);
    expect(valueAt(t, v, 24.9)).toBe(2);
    expect(valueAt(t, v, 1000)).toBe(5);
  });
  it('returns null before the first sample and for NaN samples', () => {
    expect(valueAt(t, v, 9)).toBeNull();
    expect(valueAt(t, v, 30)).toBeNull();
  });
  it('returns null when the nearest sample is older than maxAge', () => {
    expect(valueAt(t, v, 45, 4)).toBeNull();
    expect(valueAt(t, v, 43, 4)).toBe(4);
  });
  it('handles empty input', () => {
    expect(valueAt([], [], 5)).toBeNull();
  });
});

describe('indices', () => {
  it('finds bounds', () => {
    expect(lowerBound(t, 25)).toBe(2);
    expect(lowerBound(t, 10)).toBe(0);
    expect(lowerBound(t, 99)).toBe(5);
    expect(indexAtOrBefore(t, 5)).toBe(-1);
    expect(indexAtOrBefore(t, 40)).toBe(3);
  });
  it('windows inclusive of both ends', () => {
    expect(windowIndices(t, 20, 40)).toEqual([1, 4]);
    expect(windowIndices(t, 21, 39)).toEqual([2, 3]);
    expect(windowIndices(t, 60, 70)).toEqual([5, 5]);
  });
});

describe('buildChartWindow', () => {
  const tMs = [1000, 2000, 3000, 10_000, 11_000];
  const vals = [0.5, 0.6, 0.7, 0.8, 0.9];

  it('pads both edges with NaN so the chart spans the whole window, in seconds', () => {
    const w = buildChartWindow(tMs, vals, 500, 3500, 5000, 100);
    expect(Array.from(w.t)).toEqual([0.5, 1, 2, 3, 3.5]);
    expect(Number.isNaN(w.y[0]!)).toBe(true);
    expect(Array.from(w.y.subarray(1, 4)).map((v) => Math.round(v))).toEqual([50, 60, 70]);
    expect(Number.isNaN(w.y[4]!)).toBe(true);
  });

  it('breaks the line inside gaps wider than gapMs', () => {
    const w = buildChartWindow(tMs, vals, 0, 12_000, 5000);
    expect(Array.from(w.t)).toEqual([0, 1, 2, 3, 5.5, 10, 11, 12]);
    expect(Number.isNaN(w.y[4]!)).toBe(true);
  });

  it('returns only the edge padding when the window holds no samples', () => {
    const w = buildChartWindow(tMs, vals, 20_000, 30_000, 5000);
    expect(Array.from(w.t)).toEqual([20, 30]);
  });
});
