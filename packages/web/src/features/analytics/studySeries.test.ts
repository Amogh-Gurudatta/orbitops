import { describe, expect, it } from 'vitest';
import { composeStudySeries, resampleLinear } from './studySeries.ts';

describe('resampleLinear', () => {
  it('interpolates between source points and nulls outside the span', () => {
    expect(resampleLinear([0, 10], [0, 100], [-1, 0, 5, 10, 11])).toEqual([null, 0, 50, 100, null]);
  });
  it('propagates gaps', () => {
    expect(resampleLinear([0, 10, 20], [0, null, 20], [5, 15, 20])).toEqual([null, null, 20]);
  });
  it('handles an empty source', () => {
    expect(resampleLinear([], [], [1, 2])).toEqual([null, null]);
  });
});

describe('composeStudySeries', () => {
  const base = {
    histT: [0, 60_000, 120_000],
    avg: [1, 2, 3],
    min: [0, 1, 2],
    max: [2, 3, 4],
    baseT: [0, 240_000],
    baseAvg: [10, 20],
    scale: 1,
    liveSpacingS: 5,
    bucketS: 60,
  };

  it('appends live points after the last history bucket, thinned, with null bands', () => {
    // Last bucket starts at 120 s and spans 60 s, so live data counts from 180 s.
    const live = { liveT: [150, 181, 183, 187, 200], liveV: [9, 4, 5, NaN, 6] };
    const { t, series } = composeStudySeries({ ...base, ...live });
    expect(t).toEqual([0, 60, 120, 181, 200]);
    const [avg, baseline, min, max] = series;
    expect(avg).toEqual([1, 2, 3, 4, 6]);
    expect(min!.slice(3)).toEqual([null, null]);
    expect(max!.slice(3)).toEqual([null, null]);
    // Baseline resampled across the whole axis: 10 at 0 s .. 20 at 240 s.
    expect(baseline![0]).toBe(10);
    expect(baseline![2]).toBeCloseTo(15);
    expect(baseline![4]).toBeCloseTo(10 + (10 * 200) / 240);
  });

  it('scales display units (battery fraction to percent)', () => {
    const { series } = composeStudySeries({ ...base, scale: 100, liveT: [], liveV: [] });
    expect(series[0]).toEqual([100, 200, 300]);
  });

  it('shows live data alone when history is empty', () => {
    const { t, series } = composeStudySeries({
      ...base,
      histT: [],
      avg: [],
      min: [],
      max: [],
      liveT: [5, 6],
      liveV: [1, 2],
    });
    expect(t).toEqual([5]);
    expect(series[0]).toEqual([1]);
  });
});
