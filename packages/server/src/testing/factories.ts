// Test data builders shared by the server unit tests.
import type { TelemetryEvent, TelemetryFrame } from '@orbitops/shared';

export const frame = (overrides: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
  lat: 10,
  lon: 20,
  altKm: 420,
  velKms: 7.6,
  shadow: 0,
  solarW: 1500,
  batSoc: 0.9,
  batV: 28,
  busA: 5,
  panelTempC: 30,
  obcTempC: 25,
  rssiDbm: -90,
  snrDb: 12,
  stationId: 'SVAL',
  elevDeg: 30,
  attRateDps: 0.05,
  propKg: 10,
  mode: 'NOMINAL',
  ...overrides,
});

export const event = (
  seq: number,
  ts = 1_700_000_000_000 + seq * 100,
  data = frame(),
): TelemetryEvent => ({
  seq,
  ts,
  type: 'tm',
  data,
});
