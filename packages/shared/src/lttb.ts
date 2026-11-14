// Largest-Triangle-Three-Buckets downsampling (Steinarsson, 2013): keeps the visual shape of a series
// using far fewer points. O(n). Used by the server history API and by client-side charts.

/**
 * Returns the indices (ascending) of the points to keep. The first and last points are always kept.
 * If the series already fits within `threshold`, every index is returned.
 */
export function lttbIndices(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  threshold: number,
): number[] {
  const n = Math.min(xs.length, ys.length);
  if (threshold >= n) return Array.from({ length: n }, (_, i) => i);
  if (threshold < 3) return n === 0 ? [] : n === 1 ? [0] : [0, n - 1];

  const x = (i: number): number => xs[i] as number;
  const y = (i: number): number => ys[i] as number;
  const kept: number[] = [0];
  const bucketSize = (n - 2) / (threshold - 2);
  let anchor = 0;

  for (let bucket = 0; bucket < threshold - 2; bucket++) {
    // Average of the NEXT bucket is the third triangle vertex.
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, n);
    let avgX = 0;
    let avgY = 0;
    for (let i = nextStart; i < nextEnd; i++) {
      avgX += x(i);
      avgY += y(i);
    }
    const nextCount = nextEnd - nextStart;
    avgX /= nextCount;
    avgY /= nextCount;

    // Pick the point in the CURRENT bucket forming the largest triangle with the anchor and the average.
    const start = Math.floor(bucket * bucketSize) + 1;
    const end = nextStart;
    let bestArea = -1;
    let bestIndex = start;
    for (let i = start; i < end; i++) {
      const area = Math.abs(
        (x(anchor) - avgX) * (y(i) - y(anchor)) - (x(anchor) - x(i)) * (avgY - y(anchor)),
      );
      if (area > bestArea) {
        bestArea = area;
        bestIndex = i;
      }
    }
    kept.push(bestIndex);
    anchor = bestIndex;
  }

  kept.push(n - 1);
  return kept;
}

/** Convenience for arrays of points. */
export function lttbPoints<T extends { t: number; v: number }>(
  points: readonly T[],
  threshold: number,
): T[] {
  const indices = lttbIndices(
    points.map((p) => p.t),
    points.map((p) => p.v),
    threshold,
  );
  return indices.map((i) => points[i] as T);
}
