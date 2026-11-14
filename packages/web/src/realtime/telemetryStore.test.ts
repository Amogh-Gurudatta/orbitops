import { describe, expect, it, vi } from 'vitest';
import { telemetryStore } from './telemetryStore.ts';
import { METRIC_COUNT, metricColumn } from './metrics.ts';
import type { TelemetryHistory } from '../api/types.ts';

/** Builds a worker-style chunk: samples at `times` (epoch s) with batSoc = soc[i], other metrics NaN. */
function chunk(satId: number, times: number[], soc: number[]) {
  const n = times.length;
  const values = new Float64Array(n * METRIC_COUNT).fill(NaN);
  soc.forEach((v, i) => {
    values[metricColumn('batSoc') * n + i] = v;
  });
  return { satId, n, t: Float64Array.from(times), values };
}

function history(
  satId: number,
  tMs: number[],
  soc: (number | null)[],
  lastSeq: number,
): TelemetryHistory {
  return { satId, source: 'raw', t: tMs, series: { batSoc: soc }, lastSeq, serverTime: 0 };
}

describe('telemetryStore', () => {
  it('appends live chunks and reads them through a window reader', () => {
    telemetryStore.applyBatch({ latest: [], samples: [chunk(1, [10, 11, 12], [0.9, 0.8, 0.7])] });
    const reader = telemetryStore.reader(1, ['batSoc']);
    const data = reader.read()!;
    expect(Array.from(data.t)).toEqual([10, 11, 12]);
    expect(Array.from(data.series[0]!)).toEqual([0.9, 0.8, 0.7]);
  });

  it('returns null from read() until something changes', () => {
    telemetryStore.applyBatch({ latest: [], samples: [chunk(2, [1], [0.5])] });
    const reader = telemetryStore.reader(2, ['batSoc']);
    expect(reader.read()).not.toBeNull();
    expect(reader.read()).toBeNull();
    telemetryStore.applyBatch({ latest: [], samples: [chunk(2, [2], [0.4])] });
    expect(reader.read()).not.toBeNull();
  });

  it('places history ahead of live data, drops overlap, and reports the watermark', () => {
    const sink = vi.fn();
    telemetryStore.setWatermarkSink(sink);
    telemetryStore.applyBatch({ latest: [], samples: [chunk(3, [100, 101], [0.5, 0.4])] });
    telemetryStore.mergeHistory(
      3,
      history(3, [97_000, 98_000, 99_000, 100_000, 101_000], [1, 0.9, 0.8, 0.7, 0.6], 55),
    );

    const data = telemetryStore.reader(3, ['batSoc']).read()!;
    // history points at t >= first live sample (100) are discarded in favour of live data
    expect(Array.from(data.t)).toEqual([97, 98, 99, 100, 101]);
    expect(Array.from(data.series[0]!)).toEqual([1, 0.9, 0.8, 0.5, 0.4]);
    expect(sink).toHaveBeenCalledWith(3, 55);
    telemetryStore.setWatermarkSink(null);
  });

  it('serves history alone before any live sample and maps null to NaN', () => {
    telemetryStore.mergeHistory(4, history(4, [1000, 2000], [0.5, null], 1));
    const data = telemetryStore.reader(4, ['batSoc', 'panelTempC']).read()!;
    expect(Array.from(data.t)).toEqual([1, 2]);
    expect(Number.isNaN(data.series[0]![1]!)).toBe(true);
    expect(Number.isNaN(data.series[1]![0]!)).toBe(true);
  });

  it('trims to the requested window relative to the newest sample', () => {
    telemetryStore.applyBatch({
      latest: [],
      samples: [chunk(5, [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6])],
    });
    const data = telemetryStore.reader(5, ['batSoc']).read(2)!;
    expect(Array.from(data.t)).toEqual([4, 5, 6]);
  });

  it('merges latest frames and tracks freshness', () => {
    telemetryStore.applyBatch({
      latest: [{ satId: 6, seq: 1, t: 5000, frame: { lat: 1, lon: 2 } }],
      samples: [],
    });
    telemetryStore.applyBatch({
      latest: [{ satId: 6, seq: 2, t: 6000, frame: { lat: 3 } }],
      samples: [],
    });
    expect(telemetryStore.latest(6)).toEqual({ lat: 3, lon: 2 });
    expect(telemetryStore.lastSeenAt(6)).toBeGreaterThan(0);
  });
});
