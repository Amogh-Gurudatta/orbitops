import { describe, expect, it } from 'vitest';
import { event } from '../testing/factories.js';
import { ReorderBuffer } from './reorder.js';

const seqs = (events: { seq: number }[]) => events.map((e) => e.seq);

describe('ReorderBuffer', () => {
  it('releases in-order events immediately', () => {
    const buf = new ReorderBuffer(250, 64);
    expect(seqs(buf.push(event(1), 0).released)).toEqual([1]);
    expect(seqs(buf.push(event(2), 10).released)).toEqual([2]);
    expect(buf.size).toBe(0);
  });

  it('puts out-of-order events back in order within the hold window', () => {
    const buf = new ReorderBuffer(250, 64);
    buf.push(event(1), 0);
    const held = buf.push(event(3), 10);
    expect(held.released).toEqual([]);
    const result = buf.push(event(2), 20);
    expect(seqs(result.released)).toEqual([2, 3]);
    expect(buf.push(event(3), 30).late).toHaveLength(1);
  });

  it('counts a reordered event', () => {
    const buf = new ReorderBuffer(250, 64);
    buf.push(event(1), 0);
    buf.push(event(3), 1);
    expect(buf.push(event(2), 2).reordered).toBe(1);
  });

  it('reports events below the released watermark as late', () => {
    const buf = new ReorderBuffer(250, 64);
    buf.push(event(5), 0);
    buf.push(event(6), 1);
    const result = buf.push(event(4), 2);
    expect(seqs(result.late)).toEqual([4]);
    expect(result.released).toEqual([]);
  });

  it('skips a gap after the hold time and counts the missing seqs', () => {
    const buf = new ReorderBuffer(250, 64);
    buf.push(event(1), 0);
    buf.push(event(4), 100);
    expect(buf.flush(300).released).toEqual([]);
    const result = buf.flush(350);
    expect(seqs(result.released)).toEqual([4]);
    expect(result.gaps).toBe(2);
    expect(seqs(buf.push(event(2), 400).late)).toEqual([2]);
  });

  it('force-releases when more than maxEvents are held', () => {
    const buf = new ReorderBuffer(10_000, 3);
    buf.push(event(1), 0);
    const released: number[] = [];
    for (const seq of [3, 4, 5, 6]) released.push(...seqs(buf.push(event(seq), 1).released));
    expect(released).toEqual([3, 4, 5, 6].slice(0, released.length));
    expect(released.length).toBeGreaterThan(0);
  });

  it('treats a large forward jump as a new epoch rather than a gap to wait on', () => {
    const buf = new ReorderBuffer(250, 64);
    buf.push(event(10), 0);
    const result = buf.push(event(10_000), 5);
    expect(seqs(result.released)).toEqual([10_000]);
    expect(result.gaps).toBe(0);
    expect(seqs(buf.push(event(10_001), 6).released)).toEqual([10_001]);
  });
});
