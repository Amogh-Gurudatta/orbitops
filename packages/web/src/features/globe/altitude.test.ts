import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M, visualAltitudeM } from './altitude.ts';

describe('visualAltitudeM', () => {
  it('is zero at or below the surface and for invalid input', () => {
    expect(visualAltitudeM(0)).toBe(0);
    expect(visualAltitudeM(-10)).toBe(0);
    expect(visualAltitudeM(Number.NaN)).toBe(0);
  });

  it('increases monotonically with altitude', () => {
    const alts = [200, 400, 800, 2000, 20_200, 35_786];
    const visual = alts.map(visualAltitudeM);
    expect([...visual].sort((a, b) => a - b)).toEqual(visual);
  });

  it('lifts LEO above its real height', () => {
    expect(visualAltitudeM(550)).toBeGreaterThan(550_000);
    expect(visualAltitudeM(550)).toBeLessThan(550_000 * 3);
  });

  it('keeps GEO within one Earth radius of the surface', () => {
    expect(visualAltitudeM(35_786)).toBeLessThan(EARTH_RADIUS_M);
    expect(visualAltitudeM(35_786)).toBeLessThan(35_786_000);
  });
});
