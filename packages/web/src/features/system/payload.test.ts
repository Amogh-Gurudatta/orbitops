import { describe, expect, it } from 'vitest';
import type { TelemetryFrame } from '@orbitops/shared';
import { payloadSizes, savedFraction } from './payload.ts';

const full: TelemetryFrame = {
  lat: 12.3456,
  lon: -45.6789,
  altKm: 550.1,
  velKms: 7.6,
  shadow: 0,
  solarW: 120.5,
  batSoc: 0.873,
  batV: 28.1,
  busA: 1.52,
  panelTempC: 31.4,
  obcTempC: 28.8,
  rssiDbm: -98.2,
  snrDb: 12.5,
  stationId: 'svalbard',
  elevDeg: 23.4,
  attRateDps: 0.12,
  propKg: 3.2,
  mode: 'NOMINAL',
};

describe('payloadSizes', () => {
  const update = {
    satId: 25544,
    seq: 8123,
    t: 1_794_691_438_088,
    frame: { lat: 12.3456, lon: -45.6789, batSoc: 0.873 },
  };
  const sizes = payloadSizes(update, full);

  it('uses short wire keys for the changed fields only', () => {
    expect(sizes.wire.s).toBe(25544);
    expect(Object.keys(sizes.wire.d)).toEqual(['a', 'o', 'b']);
  });

  it('is much smaller than the naive JSON broadcast', () => {
    expect(sizes.compactDelta).toBeLessThan(sizes.jsonDelta);
    expect(sizes.jsonDelta).toBeLessThan(sizes.jsonFull);
    expect(savedFraction(sizes.compactDelta, sizes.jsonFull)).toBeGreaterThan(0.8);
  });
});

describe('savedFraction', () => {
  it('handles empty baselines and never goes negative', () => {
    expect(savedFraction(10, 0)).toBe(0);
    expect(savedFraction(20, 10)).toBe(0);
    expect(savedFraction(25, 100)).toBe(0.75);
  });
});
