import { describe, expect, it } from 'vitest';
import { computePasses, type StationSite, type TleSource } from './passes.js';

// ISS TLE from the repo's catalogue snapshot (epoch 2026-11-13), propagated two days later.
const ISS: TleSource = {
  line1: '1 25544U 98067A   26317.91612726  .00008668  00000+0  16320-3 0  9995',
  line2: '2 25544  51.6324 279.1461 0007382  22.6178 337.5134 15.49359724594967',
};
const WALLOPS: StationSite = { lat: 37.94, lon: -75.46, altKm: 0.01, minElevDeg: 5 };
const FROM = Date.UTC(2026, 10, 15, 0, 0, 0);
const HOUR = 3_600_000;

describe('computePasses', () => {
  const passes = computePasses(ISS, WALLOPS, FROM, 24);

  it('finds several short passes per day for the ISS over a mid-latitude station', () => {
    expect(passes.length).toBeGreaterThanOrEqual(3);
    expect(passes.length).toBeLessThanOrEqual(8);
    for (const pass of passes) {
      expect(pass.aos).toBeLessThan(pass.los);
      expect(pass.los - pass.aos).toBeLessThan(15 * 60_000);
      expect(pass.maxElevDeg).toBeGreaterThanOrEqual(WALLOPS.minElevDeg - 0.5);
      expect(pass.maxElevDeg).toBeLessThanOrEqual(90);
    }
  });

  it('returns passes in time order without overlap, overlapping the window', () => {
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i]!;
      expect(pass.los).toBeGreaterThan(FROM);
      expect(pass.aos).toBeLessThan(FROM + 24 * HOUR);
      if (i > 0) expect(pass.aos).toBeGreaterThan(passes[i - 1]!.los);
    }
  });

  it('reports the true AOS/LOS of a pass that is already in progress at the window start', () => {
    const first = passes[0]!;
    const midPass = first.aos + 60_000;
    const traced = computePasses(ISS, WALLOPS, midPass, 1);
    expect(Math.abs(traced[0]!.aos - first.aos)).toBeLessThanOrEqual(2000);
    expect(Math.abs(traced[0]!.los - first.los)).toBeLessThanOrEqual(2000);
  });

  it('is stable when the same window is recomputed', () => {
    expect(computePasses(ISS, WALLOPS, FROM, 24)).toEqual(passes);
  });

  it('sees fewer passes with a higher minimum elevation', () => {
    const strict = computePasses(ISS, { ...WALLOPS, minElevDeg: 40 }, FROM, 24);
    expect(strict.length).toBeLessThan(passes.length);
  });
});
