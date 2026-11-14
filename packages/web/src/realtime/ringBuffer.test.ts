import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ringBuffer.ts';

describe('RingBuffer', () => {
  it('returns rows oldest to newest before wrapping', () => {
    const rb = new RingBuffer(4, 2);
    rb.push(1, [10, 100]);
    rb.push(2, [20, 200]);
    const view = rb.toArrays();
    expect(view.length).toBe(2);
    expect(Array.from(view.t)).toEqual([1, 2]);
    expect(Array.from(view.columns[0]!)).toEqual([10, 20]);
    expect(Array.from(view.columns[1]!)).toEqual([100, 200]);
  });

  it('overwrites the oldest rows once full and stays contiguous', () => {
    const rb = new RingBuffer(3);
    for (let i = 1; i <= 7; i++) rb.push(i, [i * 10]);
    const view = rb.toArrays();
    expect(view.length).toBe(3);
    expect(Array.from(view.t)).toEqual([5, 6, 7]);
    expect(Array.from(view.columns[0]!)).toEqual([50, 60, 70]);
    expect(rb.firstTime()).toBe(5);
    expect(rb.lastTime()).toBe(7);
  });

  it('pushMany consumes the column-major chunk layout', () => {
    const rb = new RingBuffer(10, 2);
    // n = 3 rows: column 0 = [1,2,3], column 1 = [4,5,6]
    rb.pushMany(Float64Array.of(100, 101, 102), Float64Array.of(1, 2, 3, 4, 5, 6));
    const view = rb.toArrays();
    expect(Array.from(view.t)).toEqual([100, 101, 102]);
    expect(Array.from(view.columns[1]!)).toEqual([4, 5, 6]);
  });

  it('keeps only the newest rows when a chunk exceeds capacity', () => {
    const rb = new RingBuffer(2);
    rb.pushMany([1, 2, 3, 4], [10, 20, 30, 40]);
    expect(Array.from(rb.toArrays().t)).toEqual([3, 4]);
    expect(Array.from(rb.toArrays().columns[0]!)).toEqual([30, 40]);
  });

  it('caches the view until the buffer changes', () => {
    const rb = new RingBuffer(4);
    rb.push(1, [1]);
    const a = rb.toArrays();
    expect(rb.toArrays()).toBe(a);
    rb.push(2, [2]);
    expect(rb.toArrays()).not.toBe(a);
  });

  it('clear empties the buffer', () => {
    const rb = new RingBuffer(4);
    rb.push(1, [1]);
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.firstTime()).toBeUndefined();
    expect(rb.toArrays().length).toBe(0);
  });

  it('fills missing values with NaN', () => {
    const rb = new RingBuffer(2, 2);
    rb.push(1, [5]);
    expect(Number.isNaN(rb.toArrays().columns[1]![0])).toBe(true);
  });
});
