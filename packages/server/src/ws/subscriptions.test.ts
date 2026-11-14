import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './subscriptions.js';
import { mergeDelta, toFleetDelta } from './coalesce.js';

describe('SlidingWindowLimiter', () => {
  it('allows up to max hits per window and recovers afterwards', () => {
    const limiter = new SlidingWindowLimiter(3, 1000);
    expect([0, 100, 200].map((t) => limiter.allow(t))).toEqual([true, true, true]);
    expect(limiter.allow(300)).toBe(false);
    expect(limiter.allow(1100)).toBe(true);
  });
});

describe('delta coalescing', () => {
  it('merges later values over earlier ones and keeps the newest seq', () => {
    const acc = new Map();
    mergeDelta(acc, { s: 1, q: 1, t: 10, d: { b: 0.5, tp: 20 } });
    mergeDelta(acc, { s: 1, q: 2, t: 20, d: { b: 0.4 } });
    expect(acc.get(1)).toEqual({ s: 1, q: 2, t: 20, d: { b: 0.4, tp: 20 } });
  });

  it('does not alias the source delta', () => {
    const acc = new Map();
    const source = { s: 1, q: 1, t: 10, d: { b: 0.5 } };
    mergeDelta(acc, source);
    mergeDelta(acc, { s: 1, q: 2, t: 20, d: { tp: 1 } });
    expect(source.d).toEqual({ b: 0.5 });
  });

  it('restricts fleet deltas to position, key status and the fleet-table columns', () => {
    expect(
      toFleetDelta({
        s: 1,
        q: 1,
        t: 1,
        d: { a: 1, o: 2, h: 3, b: 0.5, m: 'SAFE', sh: 1, tp: 9, r: -90 },
      })?.d,
    ).toEqual({
      a: 1,
      o: 2,
      h: 3,
      b: 0.5,
      m: 'SAFE',
      sh: 1,
      tp: 9,
    });
    expect(toFleetDelta({ s: 1, q: 1, t: 1, d: { r: -90 } })).toBeNull();
  });
});
