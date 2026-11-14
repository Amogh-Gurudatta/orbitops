import { describe, expect, it } from 'vitest';
import { twoline2satrec } from 'satellite.js';
import { geodeticAt, groundTrack, visibleCounts } from './orbit.ts';

// ISS (ZARYA) element set; any valid LEO TLE works since the tests only use self-consistent geometry.
const satrec = twoline2satrec(
  '1 25544U 98067A   26318.51782528  .00016717  00000+0  30143-3 0  9993',
  '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560000  1006',
);
const EPOCH_MS = Date.UTC(2026, 10, 14, 12, 25, 0);

describe('geodeticAt', () => {
  it('returns a plausible LEO sub-satellite point', () => {
    const g = geodeticAt(satrec, new Date(EPOCH_MS));
    expect(g).not.toBeNull();
    expect(Math.abs(g!.lat)).toBeLessThanOrEqual(52.5);
    expect(g!.lon).toBeGreaterThanOrEqual(-180);
    expect(g!.lon).toBeLessThan(180);
    expect(g!.altKm).toBeGreaterThan(300);
    expect(g!.altKm).toBeLessThan(500);
  });
});

describe('groundTrack', () => {
  it('samples at the requested step', () => {
    const track = groundTrack(satrec, EPOCH_MS, EPOCH_MS + 10 * 60_000, 60_000);
    expect(track).toHaveLength(11);
  });
});

describe('visibleCounts', () => {
  const g = geodeticAt(satrec, new Date(EPOCH_MS))!;
  const below = { id: 'UNDER', lat: g.lat, lon: g.lon, altKm: 0, minElevDeg: 10 };
  const antipode = {
    id: 'ANTI',
    lat: -g.lat,
    lon: g.lon > 0 ? g.lon - 180 : g.lon + 180,
    altKm: 0,
    minElevDeg: 5,
  };

  it('sees a satellite overhead and not one on the far side of Earth', () => {
    const counts = visibleCounts([satrec], [below, antipode], EPOCH_MS);
    expect(counts.get('UNDER')).toBe(1);
    expect(counts.get('ANTI')).toBe(0);
  });

  it('reports zero for every station when there are no satellites', () => {
    expect(visibleCounts([], [below], EPOCH_MS).get('UNDER')).toBe(0);
  });
});
