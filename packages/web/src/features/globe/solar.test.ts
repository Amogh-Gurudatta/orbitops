import { describe, expect, it } from 'vitest';
import { nightPolygon, subsolarPoint } from './solar.ts';

describe('subsolarPoint', () => {
  it('sits near the Tropic of Cancer at the June solstice, on the meridian at 12:00 UTC', () => {
    const { lat, lon } = subsolarPoint(Date.UTC(2026, 5, 21, 12, 0, 0));
    expect(lat).toBeGreaterThan(23);
    expect(lat).toBeLessThan(23.6);
    expect(Math.abs(lon)).toBeLessThan(3);
  });

  it('moves west by 15 degrees per hour', () => {
    const a = subsolarPoint(Date.UTC(2026, 2, 1, 12, 0, 0)).lon;
    const b = subsolarPoint(Date.UTC(2026, 2, 1, 13, 0, 0)).lon;
    expect(a - b).toBeCloseTo(15, 0);
  });

  it('is in the southern hemisphere in November', () => {
    expect(subsolarPoint(Date.UTC(2026, 10, 15, 0, 0, 0)).lat).toBeLessThan(-15);
  });
});

describe('nightPolygon', () => {
  it('closes through the south pole in northern summer', () => {
    const ring = nightPolygon(Date.UTC(2026, 5, 21, 12, 0, 0));
    expect(ring.at(-1)).toEqual([-180, -90]);
    expect(ring.at(-2)).toEqual([180, -90]);
  });

  it('closes through the north pole in northern winter', () => {
    const ring = nightPolygon(Date.UTC(2026, 11, 21, 12, 0, 0));
    expect(ring.at(-1)).toEqual([-180, 90]);
  });

  it('keeps the terminator at 90 degrees from the sub-solar point', () => {
    const ms = Date.UTC(2026, 3, 10, 6, 30, 0);
    const sun = subsolarPoint(ms);
    const rad = Math.PI / 180;
    const ring = nightPolygon(ms, 10);
    for (const [lon, lat] of ring.slice(0, -2)) {
      const cosDist =
        Math.sin(lat * rad) * Math.sin(sun.lat * rad) +
        Math.cos(lat * rad) * Math.cos(sun.lat * rad) * Math.cos((lon - sun.lon) * rad);
      expect(Math.abs(cosDist)).toBeLessThan(1e-6);
    }
  });
});
