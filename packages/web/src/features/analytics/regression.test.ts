import { describe, expect, it } from 'vitest';
import { leastSquares } from './regression.ts';

describe('leastSquares', () => {
  it('recovers an exact line', () => {
    const fit = leastSquares([0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(fit.slope).toBeCloseTo(2);
    expect(fit.intercept).toBeCloseTo(1);
    expect(fit.r2).toBeCloseTo(1);
    expect(fit.n).toBe(4);
  });

  it('fits noisy data with a sensible R²', () => {
    const fit = leastSquares([0, 1, 2, 3, 4], [0, 1.2, 1.8, 3.1, 3.9])!;
    expect(fit.slope).toBeCloseTo(0.99, 1);
    expect(fit.r2).toBeGreaterThan(0.98);
    expect(fit.r2).toBeLessThanOrEqual(1);
  });

  it('gives a negative slope for anti-correlated data', () => {
    expect(leastSquares([0, 50, 100], [90, 70, 50])!.slope).toBeCloseTo(-0.4);
  });

  it('skips missing pairs', () => {
    const fit = leastSquares([0, null, 2, 3], [0, 5, 2, null])!;
    expect(fit.n).toBe(2);
    expect(fit.slope).toBeCloseTo(1);
  });

  it('is undefined for too few points or constant x', () => {
    expect(leastSquares([1], [1])).toBeNull();
    expect(leastSquares([2, 2, 2], [1, 2, 3])).toBeNull();
    expect(leastSquares([], [])).toBeNull();
  });

  it('reports R² of 1 for a flat response', () => {
    expect(leastSquares([0, 1, 2], [5, 5, 5])!.r2).toBe(1);
  });
});
