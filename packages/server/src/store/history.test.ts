import { describe, expect, it } from 'vitest';
import { downsampleColumns, type Columns } from './history.js';

function columns(rows: number): Columns {
  const t = Array.from({ length: rows }, (_, i) => i * 1000);
  return {
    t,
    series: {
      slow: t.map((_, i) => Math.sin(i / 50)),
      spiky: t.map((_, i) => (i === 700 ? 100 : 0)),
    },
    lastSeq: 4242,
  };
}

describe('downsampleColumns', () => {
  it('returns the input untouched when it already fits', () => {
    const input = columns(100);
    expect(downsampleColumns(input, ['slow'], 1000)).toBe(input);
  });

  it('keeps every column aligned and within the point budget', () => {
    const out = downsampleColumns(columns(5000), ['slow', 'spiky'], 200);
    expect(out.t.length).toBeLessThanOrEqual(200);
    expect(out.series.slow).toHaveLength(out.t.length);
    expect(out.series.spiky).toHaveLength(out.t.length);
    expect(out.t).toEqual([...out.t].sort((a, b) => a - b));
    expect(out.t[0]).toBe(0);
    expect(out.t.at(-1)).toBe(4999 * 1000);
    expect(out.lastSeq).toBe(4242);
  });

  it('preserves the shape of each metric, not just the first (a spike on the second survives)', () => {
    const out = downsampleColumns(columns(5000), ['slow', 'spiky'], 200);
    expect(out.series.spiky).toContain(100);
  });
});
