import { describe, expect, it, vi } from 'vitest';
import { encodeFrame, type TelemetryFrame, type TmDelta, type TmSnapshot } from '@orbitops/shared';
import { TelemetryAggregator } from './aggregator.ts';
import { METRIC_COUNT, metricColumn } from './metrics.ts';

const FULL: TelemetryFrame = {
  lat: 10,
  lon: 20,
  altKm: 500,
  velKms: 7.5,
  shadow: 0,
  solarW: 100,
  batSoc: 0.9,
  batV: 28,
  busA: 2,
  panelTempC: 30,
  obcTempC: 25,
  rssiDbm: null,
  snrDb: null,
  stationId: null,
  elevDeg: null,
  attRateDps: 0.1,
  propKg: 10,
  mode: 'NOMINAL',
};

const snapshot = (s: number, q: number, t: number): TmSnapshot => ({
  s,
  q,
  t,
  d: encodeFrame(FULL),
});
const delta = (s: number, q: number, t: number, d: Partial<TelemetryFrame>): TmDelta => ({
  s,
  q,
  t,
  d: encodeFrame(d),
});

describe('TelemetryAggregator', () => {
  it('merges deltas onto the snapshot and reports the full latest frame', () => {
    const agg = new TelemetryAggregator();
    agg.ingestSnapshots([snapshot(1, 1, 1000)]);
    agg.ingestDeltas([delta(1, 2, 1100, { batSoc: 0.8 })]);
    const batch = agg.flush()!;
    expect(batch.latest).toHaveLength(1);
    expect(batch.latest[0]!.frame.batSoc).toBe(0.8);
    expect(batch.latest[0]!.frame.lat).toBe(10);
    expect(batch.latest[0]!.seq).toBe(2);
  });

  it('returns null when nothing happened and clears after a flush', () => {
    const agg = new TelemetryAggregator();
    expect(agg.flush()).toBeNull();
    agg.ingestDeltas([delta(1, 1, 1000, { lat: 1 })]);
    expect(agg.flush()).not.toBeNull();
    expect(agg.flush()).toBeNull();
  });

  it('drops duplicate and out-of-order deltas and counts them', () => {
    const agg = new TelemetryAggregator();
    agg.ingestDeltas([
      delta(1, 5, 1000, { lat: 1 }),
      delta(1, 5, 1000, { lat: 2 }),
      delta(1, 4, 900, { lat: 3 }),
    ]);
    const batch = agg.flush()!;
    expect(batch.latest[0]!.frame.lat).toBe(1);
    expect(agg.tracker.duplicates).toBe(2);
  });

  it('applies the history watermark', () => {
    const agg = new TelemetryAggregator();
    agg.setSampledSats(new Set([1]));
    agg.setWatermark(1, 10);
    agg.ingestDeltas([delta(1, 9, 1000, { lat: 1 }), delta(1, 11, 1100, { lat: 2 })]);
    const batch = agg.flush()!;
    expect(batch.samples[0]!.n).toBe(1);
    expect(batch.latest[0]!.seq).toBe(11);
  });

  it('produces column-major sample chunks (epoch seconds) only for sampled satellites', () => {
    const agg = new TelemetryAggregator();
    agg.setSampledSats(new Set([1]));
    agg.ingestSnapshots([snapshot(1, 1, 2000), snapshot(2, 1, 2000)]);
    agg.ingestDeltas([delta(1, 2, 2100, { batSoc: 0.5 })]);
    const batch = agg.flush()!;
    expect(batch.latest).toHaveLength(2);
    expect(batch.samples).toHaveLength(1);
    const chunk = batch.samples[0]!;
    expect(chunk.satId).toBe(1);
    expect(chunk.n).toBe(2);
    expect(Array.from(chunk.t)).toEqual([2, 2.1]);
    const soc = metricColumn('batSoc');
    expect(chunk.values[soc * 2 + 0]).toBe(0.9);
    expect(chunk.values[soc * 2 + 1]).toBe(0.5);
    expect(chunk.values.length).toBe(2 * METRIC_COUNT);
  });

  it('encodes null metrics as NaN', () => {
    const agg = new TelemetryAggregator();
    agg.setSampledSats(new Set([1]));
    agg.ingestSnapshots([snapshot(1, 1, 1000)]);
    const chunk = agg.flush()!.samples[0]!;
    expect(Number.isNaN(chunk.values[metricColumn('rssiDbm')]!)).toBe(true);
  });

  it('keeps the latest frame for snapshots at or below the watermark but adds no sample', () => {
    const agg = new TelemetryAggregator();
    agg.setSampledSats(new Set([1]));
    agg.setWatermark(1, 50);
    agg.ingestSnapshots([snapshot(1, 50, 1000)]);
    const batch = agg.flush()!;
    expect(batch.latest).toHaveLength(1);
    expect(batch.samples).toHaveLength(0);
  });

  it('feeds accepted delta timestamps to the latency probe only', () => {
    const probe = vi.fn();
    const agg = new TelemetryAggregator(probe);
    agg.ingestSnapshots([snapshot(1, 1, 1000)]);
    agg.ingestDeltas([delta(1, 2, 1100, { lat: 1 }), delta(1, 2, 1100, { lat: 1 })]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(1100);
  });
});
