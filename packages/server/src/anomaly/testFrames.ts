// Test helper: a healthy baseline frame plus overrides.
import type { TelemetryFrame } from '@orbitops/shared';

export const HEALTHY: TelemetryFrame = {
  lat: 10,
  lon: 20,
  altKm: 550,
  velKms: 7.6,
  shadow: 0,
  solarW: 90,
  batSoc: 0.8,
  batV: 28,
  busA: 1.5,
  panelTempC: 30,
  obcTempC: 25,
  rssiDbm: -100,
  snrDb: 12,
  stationId: 'gs-1',
  elevDeg: 30,
  attRateDps: 0.1,
  propKg: 5,
  mode: 'NOMINAL',
};

export function frame(overrides: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return { ...HEALTHY, ...overrides };
}
