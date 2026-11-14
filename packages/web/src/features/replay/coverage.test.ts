import { describe, expect, it } from 'vitest';
import type { TelemetryHistory } from '../../api/types.ts';
import { findGaps, joinHistories } from './coverage.ts';

describe('findGaps', () => {
  it('reports leading, interior and trailing gaps above the threshold', () => {
    const t = [100, 110, 120, 400, 410];
    expect(findGaps(t, 0, 600, 50)).toEqual([
      [0, 100],
      [120, 400],
      [410, 600],
    ]);
  });
  it('ignores spacing within the threshold', () => {
    expect(findGaps([0, 10, 20], 0, 25, 50)).toEqual([]);
  });
  it('treats an empty series as one gap over the whole window', () => {
    expect(findGaps([], 5, 50, 10)).toEqual([[5, 50]]);
  });
});

const chunk = (t: number[], soc: number[]): TelemetryHistory => ({
  satId: 1,
  source: 'raw',
  t,
  series: { batSoc: soc },
  lastSeq: 0,
  serverTime: 0,
});

describe('joinHistories', () => {
  it('concatenates ascending chunks and drops a boundary sample returned twice', () => {
    const joined = joinHistories(
      [chunk([1, 2, 3], [10, 20, 30]), chunk([3, 4], [31, 40])],
      ['batSoc'],
    );
    expect(joined.t).toEqual([1, 2, 3, 4]);
    expect(joined.series.batSoc).toEqual([10, 20, 30, 40]);
  });
  it('fills metrics a chunk lacks with null', () => {
    const joined = joinHistories([chunk([1], [5])], ['batSoc', 'solarW']);
    expect(joined.series.solarW).toEqual([null]);
  });
});
