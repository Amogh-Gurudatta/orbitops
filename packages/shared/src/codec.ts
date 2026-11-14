// Compact wire format for telemetry broadcasts: short field keys plus fixed rounding precision.
// Deltas carry only the fields that changed; snapshots carry every field.
import type { TelemetryFrame } from './telemetry.js';

/** Long field name -> 1-2 character wire key. Keys must stay unique. */
export const FIELD_KEYS = {
  lat: 'a',
  lon: 'o',
  altKm: 'h',
  velKms: 'v',
  shadow: 'sh',
  solarW: 'sw',
  batSoc: 'b',
  batV: 'bv',
  busA: 'i',
  panelTempC: 'tp',
  obcTempC: 'to',
  rssiDbm: 'r',
  snrDb: 'n',
  stationId: 'st',
  elevDeg: 'e',
  attRateDps: 'ar',
  propKg: 'pk',
  mode: 'm',
} as const satisfies Record<keyof TelemetryFrame, string>;

/** Decimal places kept per numeric field; non-numeric fields (stationId, mode) are untouched. */
export const FIELD_PRECISION: Partial<Record<keyof TelemetryFrame, number>> = {
  lat: 4,
  lon: 4,
  altKm: 1,
  velKms: 3,
  shadow: 2,
  solarW: 1,
  batSoc: 3,
  batV: 2,
  busA: 2,
  panelTempC: 1,
  obcTempC: 1,
  rssiDbm: 1,
  snrDb: 1,
  elevDeg: 1,
  attRateDps: 2,
  propKg: 2,
};

export type CompactFullFrame = {
  [K in keyof TelemetryFrame as (typeof FIELD_KEYS)[K]]: TelemetryFrame[K];
};
export type CompactPartialFrame = Partial<CompactFullFrame>;

/** Incremental update: only changed fields in `d`. `s` satId, `q` seq, `t` epoch ms. */
export interface TmDelta {
  s: number;
  q: number;
  t: number;
  d: CompactPartialFrame;
}

/** Complete state sent on subscribe, before deltas start. */
export interface TmSnapshot {
  s: number;
  q: number;
  t: number;
  d: CompactFullFrame;
}

const LONG_KEYS = Object.keys(FIELD_KEYS) as (keyof TelemetryFrame)[];
const SHORT_TO_LONG = new Map<string, keyof TelemetryFrame>(
  LONG_KEYS.map((k) => [FIELD_KEYS[k], k]),
);

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Applies the per-field precision. Works on full or partial frames; returns a new object. */
export function roundFrame<T extends Partial<TelemetryFrame>>(frame: T): T {
  const out: Record<string, unknown> = { ...frame };
  for (const key of LONG_KEYS) {
    const decimals = FIELD_PRECISION[key];
    const value = out[key];
    if (decimals !== undefined && typeof value === 'number') out[key] = roundTo(value, decimals);
  }
  return out as T;
}

export function encodeFrame(frame: TelemetryFrame): CompactFullFrame;
export function encodeFrame(frame: Partial<TelemetryFrame>): CompactPartialFrame;
export function encodeFrame(frame: Partial<TelemetryFrame>): CompactPartialFrame {
  const rounded = roundFrame(frame);
  const out: Record<string, unknown> = {};
  for (const key of LONG_KEYS) {
    const value = rounded[key];
    if (value !== undefined) out[FIELD_KEYS[key]] = value;
  }
  return out as CompactPartialFrame;
}

export function decodeFrame(compact: CompactFullFrame): TelemetryFrame;
export function decodeFrame(compact: CompactPartialFrame): Partial<TelemetryFrame>;
export function decodeFrame(compact: CompactPartialFrame): Partial<TelemetryFrame> {
  const out: Record<string, unknown> = {};
  for (const [shortKey, value] of Object.entries(compact)) {
    const longKey = SHORT_TO_LONG.get(shortKey);
    if (longKey !== undefined && value !== undefined) out[longKey] = value;
  }
  return out as Partial<TelemetryFrame>;
}

/** Fields of `next` whose value differs from `prev`, after rounding (so jitter below precision is not sent). */
export function diffFrames(
  prev: TelemetryFrame | undefined,
  next: TelemetryFrame,
): Partial<TelemetryFrame> {
  const rounded = roundFrame(next);
  if (!prev) return rounded;
  const before = roundFrame(prev);
  const changed: Record<string, unknown> = {};
  for (const key of LONG_KEYS) {
    if (before[key] !== rounded[key]) changed[key] = rounded[key];
  }
  return changed as Partial<TelemetryFrame>;
}
