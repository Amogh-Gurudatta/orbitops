import { describe, expect, it } from 'vitest';
import type { Pass } from '../../api/types.ts';
import { formatDuration, layoutPassRows, rulerTicks } from './passLayout.ts';

const H = 3_600_000;
const START = Date.UTC(2026, 10, 15, 10, 0, 0);
const END = START + 12 * H;
const pass = (satId: number, aosH: number, losH: number, maxElevDeg = 40): Pass => ({
  satId,
  stationId: 'SVAL',
  aos: START + aosH * H,
  los: START + losH * H,
  maxElevDeg,
});

describe('layoutPassRows', () => {
  it('orders rows by earliest pass and bars by time', () => {
    const rows = layoutPassRows(
      [pass(2, 5, 5.2), pass(1, 3, 3.1), pass(2, 1, 1.1)],
      START,
      END,
      START,
    );
    expect(rows.map((r) => r.satId)).toEqual([2, 1]);
    expect(rows[0]!.bars.map((b) => b.pass.aos)).toEqual([START + H, START + 5 * H]);
  });

  it('converts to fractions of the window', () => {
    const [row] = layoutPassRows([pass(1, 6, 7.2)], START, END, START);
    expect(row!.bars[0]!.x).toBeCloseTo(0.5);
    expect(row!.bars[0]!.width).toBeCloseTo(1.2 / 12);
  });

  it('clamps passes that straddle the window and drops those outside it', () => {
    const rows = layoutPassRows(
      [pass(1, -0.5, 0.5), pass(2, 11.5, 12.5), pass(3, -2, -1), pass(4, 13, 14)],
      START,
      END,
      START,
    );
    expect(rows.map((r) => r.satId)).toEqual([1, 2]);
    expect(rows[0]!.bars[0]!.x).toBe(0);
    expect(rows[0]!.bars[0]!.width).toBeCloseTo(0.5 / 12);
    expect(rows[1]!.bars[0]!.x + rows[1]!.bars[0]!.width).toBeCloseTo(1);
  });

  it('marks only the pass in progress as active', () => {
    const rows = layoutPassRows([pass(1, -0.1, 0.1), pass(1, 2, 2.1)], START, END, START);
    expect(rows[0]!.bars.map((b) => b.active)).toEqual([true, false]);
  });
});

describe('rulerTicks', () => {
  it('labels whole UTC hours and leaves quarter hours blank', () => {
    const ticks = rulerTicks(START, END);
    const majors = ticks.filter((t) => t.major);
    expect(majors).toHaveLength(13);
    expect(majors[0]!.label).toBe('10');
    expect(majors[3]!.label).toBe('13');
    expect(ticks.filter((t) => !t.major).every((t) => t.label === '')).toBe(true);
  });

  it('starts at the first quarter hour after the window start', () => {
    const ticks = rulerTicks(START + 60_000, END);
    expect(ticks[0]!.x).toBeCloseTo((14 * 60_000) / (12 * H));
  });
});

describe('formatDuration', () => {
  it('formats minutes and padded seconds', () => {
    expect(formatDuration(8 * 60_000 + 5_000)).toBe('8m 05s');
  });
});
