import { describe, expect, it } from 'vitest';
import { FIELD_KEYS, decodeFrame, diffFrames, encodeFrame, roundFrame } from './codec.js';
import { validFrame } from './fixtures.js';
import type { TelemetryFrame } from './telemetry.js';

describe('codec', () => {
  it('uses unique wire keys', () => {
    const keys = Object.values(FIELD_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('applies per-field rounding precision', () => {
    const r = roundFrame(validFrame);
    expect(r.lat).toBe(51.6432);
    expect(r.lon).toBe(-122.4194);
    expect(r.altKm).toBe(417.8);
    expect(r.batSoc).toBe(0.877);
    expect(r.panelTempC).toBe(41.2);
    expect(r.stationId).toBe('svalbard');
    expect(r.mode).toBe('NOMINAL');
  });

  it('leaves null link fields untouched', () => {
    expect(roundFrame({ rssiDbm: null }).rssiDbm).toBeNull();
  });

  it('round-trips a full frame (to rounded precision)', () => {
    const compact = encodeFrame(validFrame);
    expect(compact.b).toBe(0.877);
    expect(compact.tp).toBe(41.2);
    expect(decodeFrame(compact)).toEqual(roundFrame(validFrame));
  });

  it('round-trips a partial frame and keeps nulls', () => {
    const partial: Partial<TelemetryFrame> = { batSoc: 0.5, rssiDbm: null, mode: 'LOS' };
    const compact = encodeFrame(partial);
    expect(compact).toEqual({ b: 0.5, r: null, m: 'LOS' });
    expect(decodeFrame(compact)).toEqual(partial);
  });

  it('ignores unknown wire keys when decoding', () => {
    expect(decodeFrame({ b: 0.1, zz: 1 } as never)).toEqual({ batSoc: 0.1 });
  });

  it('diffs only fields that changed after rounding', () => {
    const next = { ...validFrame, batSoc: 0.87654321 + 0.0001, lat: validFrame.lat + 0.01 };
    expect(diffFrames(validFrame, next)).toEqual({ lat: 51.6532 });
    expect(diffFrames(undefined, validFrame)).toEqual(roundFrame(validFrame));
    expect(diffFrames(validFrame, validFrame)).toEqual({});
  });
});
