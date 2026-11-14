import { describe, expect, it } from 'vitest';
import { Ewma, RateWindow, RunningStats, SlidingWindowStats } from './stats.js';

function naiveMeanStd(xs: number[]): { mean: number; std: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

/** Small deterministic PRNG so the test data is stable. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
}

describe('RunningStats', () => {
  it('matches the naive mean and sample std', () => {
    const rand = lcg(1);
    const xs = Array.from({ length: 500 }, () => 1000 + rand() * 10);
    const stats = new RunningStats();
    for (const x of xs) stats.add(x);
    const naive = naiveMeanStd(xs);
    expect(stats.mean).toBeCloseTo(naive.mean, 9);
    expect(stats.std).toBeCloseTo(naive.std, 9);
  });

  it('remove undoes add', () => {
    const stats = new RunningStats();
    [1, 2, 3, 4, 10].forEach((x) => stats.add(x));
    stats.remove(10);
    const naive = naiveMeanStd([1, 2, 3, 4]);
    expect(stats.mean).toBeCloseTo(naive.mean, 12);
    expect(stats.std).toBeCloseTo(naive.std, 12);
  });

  it('is zero-variance with fewer than two samples', () => {
    const stats = new RunningStats();
    expect(stats.variance).toBe(0);
    stats.add(5);
    expect(stats.variance).toBe(0);
  });
});

describe('SlidingWindowStats', () => {
  it('tracks only the last `size` samples, matching a naive recomputation', () => {
    const rand = lcg(7);
    const window = new SlidingWindowStats(50);
    const all: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const x = 5 + rand() * 3;
      all.push(x);
      window.push(x);
      if (window.isFull) {
        const naive = naiveMeanStd(all.slice(-50));
        expect(window.mean).toBeCloseTo(naive.mean, 8);
        expect(window.std).toBeCloseTo(naive.std, 8);
      }
    }
  });

  it('stays accurate across many slides (rebuild path)', () => {
    const rand = lcg(3);
    const window = new SlidingWindowStats(20);
    const tail: number[] = [];
    for (let i = 0; i < 9000; i++) {
      const x = 1e6 + rand();
      tail.push(x);
      if (tail.length > 20) tail.shift();
      window.push(x);
    }
    const naive = naiveMeanStd(tail);
    expect(window.mean).toBeCloseTo(naive.mean, 6);
    expect(window.std).toBeCloseTo(naive.std, 6);
  });

  it('computes z-scores against the window', () => {
    const window = new SlidingWindowStats(5);
    [10, 12, 8, 11, 9].forEach((x) => window.push(x));
    const { mean, std } = naiveMeanStd([10, 12, 8, 11, 9]);
    expect(window.isFull).toBe(true);
    expect(window.zScore(20)).toBeCloseTo((20 - mean) / std, 9);
  });

  it('keeps z finite for a perfectly flat window', () => {
    const window = new SlidingWindowStats(4);
    [3, 3, 3, 3].forEach((x) => window.push(x));
    expect(window.zScore(3)).toBe(0);
    expect(Number.isFinite(window.zScore(3.5))).toBe(true);
    expect(window.zScore(3.5)).toBeGreaterThan(100);
  });
});

describe('RateWindow', () => {
  it('reports per-second rate versus `size` samples ago, null while warming up', () => {
    const window = new RateWindow(3);
    expect(window.rateThenPush(0, 0)).toBeNull();
    expect(window.rateThenPush(1, 1000)).toBeNull();
    expect(window.rateThenPush(2, 2000)).toBeNull();
    expect(window.rateThenPush(5, 3000)).toBeCloseTo(5 / 3, 12); // vs (0, t=0)
  });

  it('returns null when time did not advance', () => {
    const window = new RateWindow(2);
    window.rateThenPush(0, 1000);
    window.rateThenPush(1, 1000);
    expect(window.rateThenPush(2, 1000)).toBeNull();
  });
});

describe('Ewma', () => {
  it('seeds with the first sample then blends', () => {
    const ewma = new Ewma(0.5);
    expect(ewma.value).toBeNull();
    expect(ewma.update(10)).toBe(10);
    expect(ewma.update(20)).toBe(15);
    expect(ewma.update(20)).toBe(17.5);
  });
});
