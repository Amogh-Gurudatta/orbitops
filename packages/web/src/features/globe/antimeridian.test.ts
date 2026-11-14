import { describe, expect, it } from 'vitest';
import { dashPath, splitAtAntimeridian, wrapLon, type LonLat } from './antimeridian.ts';

describe('wrapLon', () => {
  it('wraps into [-180, 180)', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(45)).toBe(45);
  });
});

describe('splitAtAntimeridian', () => {
  it('leaves a path without a crossing untouched', () => {
    const path: LonLat[] = [
      [10, 0],
      [20, 5],
      [30, 10],
    ];
    expect(splitAtAntimeridian(path)).toEqual([path]);
  });

  it('splits an eastward crossing and interpolates the seam latitude', () => {
    const result = splitAtAntimeridian([
      [170, 0],
      [-170, 20],
    ]);
    expect(result).toEqual([
      [
        [170, 0],
        [180, 10],
      ],
      [
        [-180, 10],
        [-170, 20],
      ],
    ]);
  });

  it('splits a westward crossing', () => {
    const [first, second] = splitAtAntimeridian([
      [-175, -10],
      [-10 - 170, -10],
      [170, 10],
      [160, 12],
    ]);
    expect(first?.at(-1)?.[0]).toBe(-180);
    expect(second?.[0]?.[0]).toBe(180);
    expect(second?.at(-1)).toEqual([160, 12]);
  });

  it('handles several crossings and drops single-point leftovers', () => {
    const result = splitAtAntimeridian([
      [179, 0],
      [-179, 1],
      [-170, 2],
      [175, 3],
    ]);
    expect(result).toHaveLength(3);
    expect(result.every((segment) => segment.length >= 2)).toBe(true);
  });

  it('returns nothing for an empty or one-point path', () => {
    expect(splitAtAntimeridian([])).toEqual([]);
    expect(splitAtAntimeridian([[0, 0]])).toEqual([]);
  });
});

describe('dashPath', () => {
  const points: LonLat[] = Array.from({ length: 10 }, (_, i) => [i, 0]);

  it('keeps `on` segments and skips `off` points', () => {
    const dashes = dashPath(points, 2, 1);
    expect(dashes[0]).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(dashes[1]?.[0]).toEqual([3, 0]);
  });

  it('drops a trailing stub that cannot form a segment', () => {
    expect(dashPath([[0, 0]], 2, 1)).toEqual([]);
  });
});
