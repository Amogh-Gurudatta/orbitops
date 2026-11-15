// Synthetic telemetry: a cheap, deterministic, schema-valid frame per (satellite, timestamp).
// Slow orbital trends plus a fast sensor-noise term, so (like real telemetry) almost every numeric field
// differs from sample to sample and deltas are realistically sized. Values stay inside nominal limits so
// the load test does not trigger alert storms.
import type { TelemetryFrame } from '@orbitops/shared';

const ORBIT_PERIOD_S = 240;
const TAU = 2 * Math.PI;

/** `index` offsets each satellite's phase so frames differ between sources. */
export function makeFrame(index: number, tsMs: number): TelemetryFrame {
  const phase = (TAU * (tsMs / 1000)) / ORBIT_PERIOD_S + index * 0.7;
  const wave = Math.sin(phase);
  // Several times larger than each field's wire precision, so noise survives rounding.
  const noise = Math.sin(tsMs / 37 + index) * Math.cos(tsMs / 91);
  return {
    lat: 51.6 * wave + noise * 0.01,
    lon: Math.max(
      -180,
      Math.min(
        180,
        (((((phase * 180) / Math.PI + index * 37) % 360) + 360) % 360) - 180 + noise * 0.01,
      ),
    ),
    altKm: 420 + 5 * Math.sin(2 * phase) + noise * 0.5,
    velKms: 7.66 + noise * 0.01,
    shadow: 0,
    solarW: 1200 + 100 * wave + noise * 5,
    batSoc: 0.75 + 0.1 * wave + noise * 0.004,
    batV: 28 + 0.5 * wave + noise * 0.05,
    busA: 5 + wave + noise * 0.1,
    panelTempC: 30 + 15 * wave + noise * 0.5,
    obcTempC: 35 + 3 * wave + noise * 0.5,
    rssiDbm: null,
    snrDb: null,
    stationId: null,
    elevDeg: null,
    attRateDps: 0.01 + 0.005 * wave + Math.abs(noise) * 0.02,
    propKg: 12 - Math.abs(noise) * 0.05,
    mode: 'NOMINAL',
  };
}
