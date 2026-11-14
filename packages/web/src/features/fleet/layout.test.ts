import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, NARROW_LAYOUT, parseLayout } from './layout.ts';

const stored = (mutate?: (items: Record<string, unknown>[]) => void) => {
  const items = DEFAULT_LAYOUT.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  mutate?.(items);
  return JSON.stringify(items);
};

describe('parseLayout', () => {
  it('accepts a complete layout and restores size limits', () => {
    const parsed = parseLayout(stored((items) => (items[1]!['w'] = 6)));
    expect(parsed).toHaveLength(5);
    expect(parsed?.find((p) => p.i === 'globe')).toMatchObject({ w: 6, minW: 3, minH: 6 });
  });

  it.each([
    ['null', null],
    ['invalid JSON', '{nope'],
    ['not an array', '{}'],
    ['missing panels', JSON.stringify([{ i: 'globe', x: 0, y: 0, w: 1, h: 1 }])],
    ['unknown panel', stored((items) => (items[0]!['i'] = 'mystery'))],
    ['duplicate panel', stored((items) => (items[1]!['i'] = 'pipeline'))],
    ['overflowing the grid', stored((items) => (items[1]!['w'] = 13))],
    ['fractional cells', stored((items) => (items[1]!['x'] = 0.5))],
    ['zero size', stored((items) => (items[2]!['h'] = 0))],
  ])('rejects %s', (_name, raw) => {
    expect(parseLayout(raw)).toBeNull();
  });
});

describe('layouts', () => {
  it('default layout stays inside the 12 x 24 grid without overlaps', () => {
    for (const a of DEFAULT_LAYOUT) {
      expect(a.x + a.w).toBeLessThanOrEqual(12);
      expect(a.y + a.h).toBeLessThanOrEqual(24);
      for (const b of DEFAULT_LAYOUT) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('narrow layout stacks every panel in one column', () => {
    expect(NARROW_LAYOUT.every((p) => p.x === 0 && p.w === 1)).toBe(true);
    const ys = NARROW_LAYOUT.map((p) => p.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
});
