import { describe, expect, it } from 'vitest';
import { runPool } from './pool.ts';
import { resolveSatId } from './satLookup.ts';

describe('runPool', () => {
  it('processes every item without exceeding the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    const result = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(n);
      inFlight--;
    });
    expect(result).toEqual({ done: 7, failed: 0 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('counts failures and reports progress', async () => {
    const progress: number[] = [];
    const result = await runPool(
      [1, 2, 3],
      1,
      async (n) => {
        if (n === 2) throw new Error('no');
      },
      (p) => progress.push(p.done + p.failed),
    );
    expect(result).toEqual({ done: 2, failed: 1 });
    expect(progress).toEqual([1, 2, 3]);
  });
});

describe('resolveSatId', () => {
  const catalog = { 25544: { name: 'ISS (ZARYA)' }, 43013: { name: 'NOAA 20' } };
  it('accepts NORAD ids and name fragments', () => {
    expect(resolveSatId('25544', catalog)).toBe(25544);
    expect(resolveSatId('noaa', catalog)).toBe(43013);
    expect(resolveSatId('nothing', catalog)).toBeNull();
    expect(resolveSatId('  ', catalog)).toBeNull();
  });
});
