// Ordinary least-squares line fit for the battery-vs-eclipse scatter trend.

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Coefficient of determination, 0..1. */
  r2: number;
  n: number;
}

/** Skips pairs with a missing coordinate. Returns null when a line is undefined (n < 2 or constant x). */
export function leastSquares(
  xs: readonly (number | null)[],
  ys: readonly (number | null)[],
): LinearFit | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  const count = Math.min(xs.length, ys.length);
  for (let i = 0; i < count; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === null || y === null || x === undefined || y === undefined) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  if (n < 2) return null;
  const varX = sxx - (sx * sx) / n;
  if (varX <= 1e-12) return null;
  const covXY = sxy - (sx * sy) / n;
  const varY = syy - (sy * sy) / n;
  const slope = covXY / varX;
  return {
    slope,
    intercept: (sy - slope * sx) / n,
    r2: varY <= 1e-12 ? 1 : Math.min(1, (covXY * covXY) / (varX * varY)),
    n,
  };
}
