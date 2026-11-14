import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  advancePlayhead,
  clampTime,
  generateTicks,
  stepTime,
  timeToX,
  utcHourMinute,
  xToTime,
} from './timeline.ts';

const H0 = Date.UTC(2026, 10, 14, 12, 0, 0);

describe('timeline ticks', () => {
  it('puts a labelled major tick on every UTC hour and minors every 10 minutes', () => {
    const ticks = generateTicks({ from: H0 + 5 * 60_000, to: H0 + 2 * HOUR_MS });
    expect(ticks[0]).toEqual({ t: H0 + 10 * 60_000, major: false });
    const majors = ticks.filter((t) => t.major);
    expect(majors.map((t) => t.label)).toEqual(['13:00', '14:00']);
    // 10-min grid from 12:10 through 14:00 inclusive = 12 ticks
    expect(ticks).toHaveLength(12);
  });

  it('includes ticks exactly on the span edges', () => {
    const ticks = generateTicks({ from: H0, to: H0 + HOUR_MS });
    expect(ticks[0]).toMatchObject({ t: H0, major: true, label: '12:00' });
    expect(ticks.at(-1)).toMatchObject({ t: H0 + HOUR_MS, major: true, label: '13:00' });
  });
});

describe('time / pixel mapping', () => {
  const span = { from: 1000, to: 3000 };
  it('maps linearly and inverts', () => {
    expect(timeToX(2000, span, 400)).toBe(200);
    expect(xToTime(200, span, 400)).toBe(2000);
  });
  it('clamps pointer positions outside the ruler', () => {
    expect(xToTime(-50, span, 400)).toBe(1000);
    expect(xToTime(999, span, 400)).toBe(3000);
    expect(clampTime(5000, span)).toBe(3000);
  });
});

describe('playhead movement', () => {
  const span = { from: 0, to: 600_000 };
  it('steps by a fixed delta within the span', () => {
    expect(stepTime(100_000, 60_000, span)).toBe(160_000);
    expect(stepTime(10_000, -60_000, span)).toBe(0);
    expect(stepTime(590_000, 60_000, span)).toBe(600_000);
  });
  it('advances by wall-clock time scaled by speed and stops at the end', () => {
    expect(advancePlayhead(0, 1000, 60, span)).toEqual({ t: 60_000, ended: false });
    expect(advancePlayhead(590_000, 1000, 60, span)).toEqual({ t: 600_000, ended: true });
  });
  it('formats UTC hour:minute', () => {
    expect(utcHourMinute(H0 + 7 * 60_000)).toBe('12:07');
  });
});
