import { describe, expect, it } from 'vitest';
import {
  coverageCells,
  footprintAngularRadiusDeg,
  footprintRadiusKm,
  stationCells,
} from './footprint.ts';

describe('footprintAngularRadiusDeg', () => {
  it('is the full horizon cap at 0 degrees elevation', () => {
    // acos(Re / (Re + h)) for h = 550 km is about 23.0 degrees.
    expect(footprintAngularRadiusDeg(550, 0)).toBeCloseTo(23.0, 1);
  });

  it('shrinks as the minimum elevation rises', () => {
    expect(footprintAngularRadiusDeg(550, 10)).toBeLessThan(footprintAngularRadiusDeg(550, 5));
    expect(footprintAngularRadiusDeg(550, 10)).toBeCloseTo(15, 0);
  });

  it('grows with altitude', () => {
    expect(footprintAngularRadiusDeg(1200, 5)).toBeGreaterThan(footprintAngularRadiusDeg(550, 5));
  });

  it('converts to ground kilometres', () => {
    expect(footprintRadiusKm(550, 10)).toBeCloseTo(15 * (Math.PI / 180) * 6371, -2);
  });
});

describe('coverage cells', () => {
  const svalbard = { id: 'SVAL', lat: 78.23, lon: 15.39, minElevDeg: 5 };
  const kiruna = { id: 'KIRU', lat: 67.86, lon: 20.96, minElevDeg: 5 };

  it('covers a plausible number of res-3 cells for one station', () => {
    const cells = stationCells(svalbard);
    // Cap area / res-3 cell area (~12 400 km2) is on the order of a few hundred.
    expect(cells.length).toBeGreaterThan(300);
    expect(cells.length).toBeLessThan(1500);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('counts overlap between nearby stations', () => {
    const cells = coverageCells([svalbard, kiruna]);
    expect(cells.some((c) => c.count === 2)).toBe(true);
    expect(cells.every((c) => c.count >= 1 && c.count <= 2)).toBe(true);
  });
});
