import { describe, expect, it } from 'vitest';
import type { TelemetryHistory } from '../../api/types.ts';
import type { ChartSource } from '../../realtime/useRealtime.ts';
import { bandColumns, createChartSource } from './chartSources.ts';

const base = (t: number[], v: number[]): ChartSource => ({
  pull: () => ({ t: Float64Array.from(t), series: [Float64Array.from(v)] }),
});

describe('createChartSource', () => {
  it('scales values to display units', () => {
    const data = createChartSource(base([1, 2], [0.5, 0.25]), { factor: 100 }).pull()!;
    expect(Array.from(data.series[0]!)).toEqual([50, 25]);
    expect(data.series).toHaveLength(1);
  });

  it('passes through a null pull (nothing changed)', () => {
    expect(createChartSource({ pull: () => null }, { factor: 1 }).pull()).toBeNull();
  });

  it('adds min/max from history buckets and collapses the envelope on live samples', () => {
    const history: TelemetryHistory = {
      satId: 1,
      source: 'rollup',
      t: [60_000, 120_000],
      series: { 'x:min': [10, 20], 'x:max': [30, 40], x: [20, 30] },
      lastSeq: 5,
      serverTime: 0,
    };
    const bands = bandColumns(history, 'x')!;
    const source = createChartSource(base([60, 120, 125], [20, 30, 35]), { factor: 1, bands });
    const data = source.pull()!;
    expect(data.series).toHaveLength(3);
    expect(Array.from(data.series[1]!)).toEqual([10, 20, 35]);
    expect(Array.from(data.series[2]!)).toEqual([30, 40, 35]);
  });

  it('returns null bands when the response has no envelope columns', () => {
    const history: TelemetryHistory = {
      satId: 1,
      source: 'raw',
      t: [1000],
      series: { x: [1] },
      lastSeq: 1,
      serverTime: 0,
    };
    expect(bandColumns(history, 'x')).toBeNull();
  });
});

describe('gap breaking', () => {
  it('inserts a NaN point inside gaps wider than gapSeconds and keeps time ascending', () => {
    const source = createChartSource(base([0, 1, 100, 101], [1, 2, 3, 4]), {
      factor: 1,
      gapSeconds: 10,
    });
    const data = source.pull()!;
    expect(data.t.length).toBe(5);
    expect(Number.isNaN(data.series[0]![2]!)).toBe(true);
    expect(Array.from(data.t)).toEqual([0, 1, 6, 100, 101]);
  });
});
