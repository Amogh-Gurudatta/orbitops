// Chart sources: wrap a telemetryStore window reader so a chart plots display units (battery 0..1 -> %)
// and, for rollup ranges, a min/max envelope. The envelope comes from the fetched history columns;
// samples newer than the history (live data) have no envelope, so min = max = the live value.
import type { TelemetryHistory } from '../../api/types.ts';
import type { ChartData } from '../../realtime/telemetryStore.ts';
import type { ChartSource } from '../../realtime/useRealtime.ts';

/** Min/max columns for one metric; `t` is epoch seconds ascending, like the store's history tier. */
export interface BandColumns {
  t: Float64Array;
  min: Float64Array;
  max: Float64Array;
}

/** Extracts `${metric}:min` / `${metric}:max` from a banded history response, if present. */
export function bandColumns(history: TelemetryHistory, metric: string): BandColumns | null {
  const lo = history.series[`${metric}:min`];
  const hi = history.series[`${metric}:max`];
  if (!lo || !hi) return null;
  const n = history.t.length;
  const t = new Float64Array(n);
  const min = new Float64Array(n);
  const max = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = history.t[i]! / 1000;
    min[i] = lo[i] ?? NaN;
    max[i] = hi[i] ?? NaN;
  }
  return { t, min, max };
}

export interface SourceOptions {
  /** Wire -> display multiplier applied to every value. */
  factor: number;
  bands?: BandColumns | null;
  /**
   * Sample spacing (seconds) above which the trace is broken: a NaN point is inserted so the line
   * does not bridge a data gap (the chart hatches the gap itself).
   */
  gapSeconds?: number;
}

const TIME_EPSILON_S = 1e-3;

/**
 * Returns a source whose series are [value] or [value, min, max]. `base` must read the one metric.
 * Output arrays are reused between pulls (StripChart copies them in `setData`).
 */
export function createChartSource(base: ChartSource, options: SourceOptions): ChartSource {
  const { factor, bands, gapSeconds = Infinity } = options;
  const count = bands ? 3 : 1;
  let capacity = 0;
  let time = new Float64Array(0);
  let scratch: Float64Array[] = [];

  const ensure = (needed: number): void => {
    if (capacity >= needed) return;
    capacity = Math.max(needed, 256, Math.ceil(capacity * 1.5));
    time = new Float64Array(capacity);
    scratch = Array.from({ length: count }, () => new Float64Array(capacity));
  };

  return {
    pull(): ChartData | null {
      const data = base.pull();
      if (!data) return null;
      const n = data.t.length;
      ensure(n * 2);
      const src = data.series[0]!;
      let out = 0;
      let j = 0; // band cursor; both sides are ascending, so one merge walk covers every sample
      for (let i = 0; i < n; i++) {
        const t = data.t[i]!;
        if (i > 0 && t - data.t[i - 1]! > gapSeconds) {
          time[out] = data.t[i - 1]! + gapSeconds / 2;
          for (const column of scratch) column[out] = NaN;
          out++;
        }
        time[out] = t;
        const value = src[i]! * factor;
        scratch[0]![out] = value;
        if (bands) {
          while (j < bands.t.length && bands.t[j]! < t - TIME_EPSILON_S) j++;
          const hit = j < bands.t.length && Math.abs(bands.t[j]! - t) <= TIME_EPSILON_S;
          scratch[1]![out] = hit ? bands.min[j]! * factor : value;
          scratch[2]![out] = hit ? bands.max[j]! * factor : value;
        }
        out++;
      }
      return { t: time.subarray(0, out), series: scratch.map((s) => s.subarray(0, out)) };
    },
  };
}
