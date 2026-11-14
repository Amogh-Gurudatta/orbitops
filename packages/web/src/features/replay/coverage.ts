// Data coverage: finds the spans of a window that no sample covers (hatched on the timeline) and
// joins chunked history responses into one ascending series.
import type { TelemetryHistory } from '../../api/types.ts';

/** Spans [from, to] inside the window with no data: leading/trailing emptiness and gaps above `minGapMs`. */
export function findGaps(
  t: ArrayLike<number>,
  from: number,
  to: number,
  minGapMs: number,
): [number, number][] {
  const gaps: [number, number][] = [];
  if (t.length === 0) return [[from, to]];
  if (t[0]! - from > minGapMs) gaps.push([from, t[0]!]);
  for (let i = 1; i < t.length; i++) {
    if (t[i]! - t[i - 1]! > minGapMs) gaps.push([t[i - 1]!, t[i]!]);
  }
  const last = t[t.length - 1]!;
  if (to - last > minGapMs) gaps.push([last, to]);
  return gaps;
}

/**
 * Concatenates history chunks (oldest first) for the same metrics. A sample at or before the previous
 * chunk's last timestamp is dropped, so a boundary point returned by both chunks appears once.
 */
export function joinHistories(chunks: readonly TelemetryHistory[], metrics: readonly string[]) {
  const t: number[] = [];
  const series: Record<string, (number | null)[]> = Object.fromEntries(metrics.map((m) => [m, []]));
  for (const chunk of chunks) {
    const last = t.length > 0 ? t[t.length - 1]! : -Infinity;
    chunk.t.forEach((ts, i) => {
      if (ts <= last) return;
      t.push(ts);
      for (const m of metrics) series[m]!.push(chunk.series[m]?.[i] ?? null);
    });
  }
  return { t, series };
}
