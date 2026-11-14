// Seam diagnostics: proves the history -> live join is clean. Counts timestamps that repeat or run
// backwards in the assembled trace (both must be zero for a seamless, duplicate-free chart).

export interface SeamReport {
  points: number;
  /** Timestamps equal to the previous one. */
  duplicates: number;
  /** Timestamps earlier than the previous one. */
  backwards: number;
}

export function analyzeSeam(t: ArrayLike<number>): SeamReport {
  let duplicates = 0;
  let backwards = 0;
  for (let i = 1; i < t.length; i++) {
    const step = t[i]! - t[i - 1]!;
    if (step === 0) duplicates++;
    else if (step < 0) backwards++;
  }
  return { points: t.length, duplicates, backwards };
}
