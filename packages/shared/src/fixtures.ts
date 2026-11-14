// Test fixtures shared by the unit tests in this package.
import type { TelemetryEvent, TelemetryFrame } from './telemetry.js';

export const validFrame: TelemetryFrame = {
  lat: 51.64321987,
  lon: -122.41941234,
  altKm: 417.8346,
  velKms: 7.66321,
  shadow: 0,
  solarW: 1234.5678,
  batSoc: 0.87654321,
  batV: 28.4567,
  busA: 12.3456,
  panelTempC: 41.2345,
  obcTempC: 33.9876,
  rssiDbm: -97.4321,
  snrDb: 12.3456,
  stationId: 'svalbard',
  elevDeg: 23.4567,
  attRateDps: 0.0123,
  propKg: 12.3456,
  mode: 'NOMINAL',
};

export const validEvent: TelemetryEvent = {
  seq: 7,
  ts: 1_700_000_000_000,
  type: 'tm',
  data: validFrame,
};
