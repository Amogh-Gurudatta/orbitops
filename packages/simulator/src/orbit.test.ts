import { describe, expect, it } from 'vitest';
import { loadGroundStations, loadSatelliteSnapshot } from './catalog.js';
import { bestVisibleStation, lookAngles, Orbit, shadowAt } from './orbit.js';

const ISS = loadSatelliteSnapshot().find((s) => s.noradId === 25544)!;
const T0 = Date.parse('2026-11-14T00:00:00Z');

describe('Orbit', () => {
  const orbit = new Orbit(ISS.line1, ISS.line2);

  it('puts the ISS at LEO altitude with sane latitude and speed over a full day', () => {
    for (let t = 0; t < 24 * 3600; t += 120) {
      const state = orbit.propagateAt(new Date(T0 + t * 1000));
      expect(state).not.toBeNull();
      expect(state!.altKm).toBeGreaterThan(370);
      expect(state!.altKm).toBeLessThan(440);
      expect(Math.abs(state!.lat)).toBeLessThanOrEqual(52);
      expect(Math.abs(state!.lon)).toBeLessThanOrEqual(180);
      expect(state!.velKms).toBeGreaterThan(7.4);
      expect(state!.velKms).toBeLessThan(7.9);
    }
  });

  it('returns null instead of throwing when SGP4 fails', () => {
    expect(orbit.propagateAt(new Date('2040-01-01T00:00:00Z'))).toBeNull();
    expect(orbit.propagateAt(new Date(NaN))).toBeNull();
  });

  it('toggles between sun and eclipse, spending roughly a third of an orbit in shadow', () => {
    const periodS = 92.9 * 60;
    let inShadow = 0;
    let samples = 0;
    let transitions = 0;
    let previous: boolean | null = null;
    for (let t = 0; t < periodS * 2; t += 30) {
      const date = new Date(T0 + t * 1000);
      const dark = shadowAt(date, orbit.propagateAt(date)!.eciPos) > 0.5;
      if (previous !== null && dark !== previous) transitions++;
      previous = dark;
      samples++;
      if (dark) inShadow++;
    }
    expect(transitions).toBeGreaterThanOrEqual(3);
    expect(inShadow / samples).toBeGreaterThan(0.25);
    expect(inShadow / samples).toBeLessThan(0.45);
  });

  it('finds a visible station with a valid elevation at some point in an orbit and none at others', () => {
    const stations = loadGroundStations();
    const seen = new Set<boolean>();
    for (let t = 0; t < 6 * 3600; t += 60) {
      const state = orbit.propagateAt(new Date(T0 + t * 1000))!;
      const best = bestVisibleStation(stations, state.ecfPos);
      seen.add(best !== null);
      if (best) {
        expect(best.elevDeg).toBeGreaterThanOrEqual(5);
        expect(best.rangeKm).toBeGreaterThan(400);
      }
    }
    expect(seen).toEqual(new Set([true, false]));
  });

  it('lookAngles is ~90 degrees straight overhead', () => {
    const state = orbit.propagateAt(new Date(T0))!;
    const below = { lat: state.lat, lon: state.lon, altKm: 0 };
    const look = lookAngles(below, state.ecfPos);
    expect(look.elevDeg).toBeGreaterThan(89);
    expect(look.rangeKm).toBeCloseTo(state.altKm, -1);
  });
});
