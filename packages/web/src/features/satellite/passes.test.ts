import { describe, expect, it } from 'vitest';
import type { Pass } from '../../api/types.ts';
import {
  classifyPasses,
  formatClock,
  formatDuration,
  formatUtcTime,
  passCountdown,
} from './passes.ts';

const pass = (aos: number, los: number): Pass => ({
  satId: 1,
  stationId: 'gs',
  aos,
  los,
  maxElevDeg: 40,
});

describe('classifyPasses', () => {
  it('marks active, next, upcoming and past passes', () => {
    const now = 1_000_000;
    const passes = [
      pass(now - 900, now - 100),
      pass(now - 50, now + 400),
      pass(now + 600, now + 900),
      pass(now + 2000, now + 2300),
    ];
    expect(classifyPasses(passes, now)).toEqual(['past', 'active', 'next', 'upcoming']);
  });

  it('has no NEXT when everything is in the past', () => {
    expect(classifyPasses([pass(0, 10)], 100)).toEqual(['past']);
  });
});

describe('formatting', () => {
  it('formats clocks with and without hours', () => {
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('00:00');
  });

  it('shows a T-minus countdown before AOS and time to LOS during the pass', () => {
    expect(passCountdown(pass(100_000, 400_000), 40_000)).toBe('T−01:00');
    expect(passCountdown(pass(100_000, 400_000), 150_000)).toBe('LOS 04:10');
  });

  it('formats duration and UTC time', () => {
    expect(formatDuration(pass(0, 485_000))).toBe('8:05');
    expect(formatUtcTime(Date.UTC(2026, 10, 1, 3, 4, 5))).toBe('03:04:05Z');
  });
});
