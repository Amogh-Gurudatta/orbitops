// Binary-search helpers over time-sorted history columns: the value in effect at a time, and the
// index window used to feed a chart around the playhead.

/** First index in sorted `t` whose value is >= x (t.length when none). */
export function lowerBound(t: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the last sample at or before x, or -1 if x precedes all samples. */
export function indexAtOrBefore(t: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * The most recent value at or before `x` (sample-and-hold), or null when there is none, the value is
 * missing, or the sample is older than `maxAge` (the same unit as `t`) so the data would be stale.
 */
export function valueAt(
  t: ArrayLike<number>,
  values: ArrayLike<number>,
  x: number,
  maxAge = Infinity,
): number | null {
  const i = indexAtOrBefore(t, x);
  if (i < 0 || x - t[i]! > maxAge) return null;
  const v = values[i]!;
  return Number.isNaN(v) ? null : v;
}

/** Index range [start, end) of samples with from <= t <= to. */
export function windowIndices(t: ArrayLike<number>, from: number, to: number): [number, number] {
  return [lowerBound(t, from), indexAtOrBefore(t, to) + 1];
}

export interface ChartWindow {
  /** Epoch seconds, padded with NaN-valued points at both window edges so the chart's x range is the window. */
  t: Float64Array;
  y: Float64Array;
}

/**
 * Samples inside [from, to] (epoch ms) as chart data in display units. A NaN point is inserted inside
 * any spacing above `gapMs` (so the line does not bridge missing data), and at both window edges.
 */
export function buildChartWindow(
  tMs: ArrayLike<number>,
  values: ArrayLike<number>,
  from: number,
  to: number,
  gapMs: number,
  factor = 1,
): ChartWindow {
  const [start, end] = windowIndices(tMs, from, to);
  const count = Math.max(0, end - start);
  const t = new Float64Array(count * 2 + 2);
  const y = new Float64Array(count * 2 + 2);
  let n = 0;
  const push = (ms: number, v: number) => {
    t[n] = ms / 1000;
    y[n] = v;
    n++;
  };
  push(from, NaN);
  for (let i = start; i < end; i++) {
    if (i > start && tMs[i]! - tMs[i - 1]! > gapMs) push(tMs[i - 1]! + gapMs / 2, NaN);
    push(tMs[i]!, values[i]! * factor);
  }
  push(to, NaN);
  return { t: t.subarray(0, n), y: y.subarray(0, n) };
}
