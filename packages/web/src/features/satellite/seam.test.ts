// History/live seam: the server's lastSeq watermark plus the store's read-time overlap rule must give
// one strictly increasing trace with no repeated samples.
import { describe, expect, it } from 'vitest';
import type { TelemetryHistory } from '../../api/types.ts';
import { METRIC_COUNT, metricColumn } from '../../realtime/metrics.ts';
import { SeqTracker } from '../../realtime/seqTracker.ts';
import { telemetryStore } from '../../realtime/telemetryStore.ts';
import { analyzeSeam } from './seam.ts';

const SAT = 9001;

/** Server-style history: raw samples every second, seq = index, newest persisted seq = lastSeq. */
function history(fromSeq: number, toSeq: number, startMs: number): TelemetryHistory {
  const t: number[] = [];
  const soc: number[] = [];
  for (let seq = fromSeq; seq <= toSeq; seq++) {
    t.push(startMs + seq * 1000);
    soc.push(1 - seq / 1000);
  }
  return { satId: SAT, source: 'raw', t, series: { batSoc: soc }, lastSeq: toSeq, serverTime: 0 };
}

function liveChunk(seqs: number[], startMs: number) {
  const n = seqs.length;
  const values = new Float64Array(n * METRIC_COUNT).fill(NaN);
  seqs.forEach((seq, i) => {
    values[metricColumn('batSoc') * n + i] = 1 - seq / 1000;
  });
  return {
    satId: SAT,
    n,
    t: Float64Array.from(seqs.map((s) => (startMs + s * 1000) / 1000)),
    values,
  };
}

describe('history + live seam', () => {
  it('drops live events at or below lastSeq and appends the rest without duplicates', () => {
    const tracker = new SeqTracker();
    const start = 1_800_000_000_000;
    const hist = history(0, 100, start);
    tracker.setWatermark(SAT, hist.lastSeq);

    // Live feed overlaps the history tail (98..100) and continues beyond it.
    const incoming = [98, 99, 100, 101, 102, 103];
    const accepted = incoming.filter((seq) => tracker.check(SAT, seq) === 'accept');
    expect(accepted).toEqual([101, 102, 103]);
    expect(tracker.belowWatermark).toBe(3);

    telemetryStore.mergeHistory(SAT, hist);
    telemetryStore.applyBatch({ latest: [], samples: [liveChunk(accepted, start)] });
    const data = telemetryStore.reader(SAT, ['batSoc']).read()!;

    expect(data.t.length).toBe(104); // seq 0..103 once each
    const report = analyzeSeam(data.t);
    expect(report).toEqual({ points: 104, duplicates: 0, backwards: 0 });
    expect(data.series[0]![103]).toBeCloseTo(1 - 103 / 1000);
  });

  it('still joins cleanly when live samples already sit in the ring before history arrives', () => {
    const sat = 9002;
    const start = 1_800_000_000_000;
    const n = 5;
    const seqs = [60, 61, 62, 63, 64];
    const values = new Float64Array(n * METRIC_COUNT).fill(NaN);
    seqs.forEach((s, i) => (values[metricColumn('batSoc') * n + i] = 0.5));
    telemetryStore.applyBatch({
      latest: [],
      samples: [
        { satId: sat, n, t: Float64Array.from(seqs.map((s) => (start + s * 1000) / 1000)), values },
      ],
    });
    // History reaches seq 62: its tail overlaps live samples 60..62.
    telemetryStore.mergeHistory(sat, { ...history(0, 62, start), satId: sat });
    const data = telemetryStore.reader(sat, ['batSoc']).read()!;
    const report = analyzeSeam(data.t);
    expect(report.duplicates).toBe(0);
    expect(report.backwards).toBe(0);
    expect(data.t.length).toBe(65);
  });

  it('analyzeSeam reports repeated and backwards timestamps', () => {
    expect(analyzeSeam([1, 2, 2, 3, 2.5, 4])).toEqual({ points: 6, duplicates: 1, backwards: 1 });
    expect(analyzeSeam([])).toEqual({ points: 0, duplicates: 0, backwards: 0 });
  });
});
