// Delta merging for the slower rooms: later values win, and the newest seq/timestamp is kept.
import { FIELD_KEYS, type TelemetryFrame, type TmDelta } from '@orbitops/shared';

/** The only fields the 1 Hz fleet overview needs: position plus key status. */
export const FLEET_FIELDS = [
  'lat',
  'lon',
  'altKm',
  'batSoc',
  'mode',
  'shadow',
] as const satisfies readonly (keyof TelemetryFrame)[];
const FLEET_KEYS: readonly string[] = FLEET_FIELDS.map((f) => FIELD_KEYS[f]);

export function mergeDelta(into: Map<number, TmDelta>, delta: TmDelta): void {
  const existing = into.get(delta.s);
  if (!existing) {
    into.set(delta.s, { ...delta, d: { ...delta.d } });
    return;
  }
  Object.assign(existing.d, delta.d);
  existing.q = delta.q;
  existing.t = delta.t;
}

/** Restricts a delta to fleet fields; null when none of them changed. */
export function toFleetDelta(delta: TmDelta): TmDelta | null {
  const d: Record<string, unknown> = {};
  let any = false;
  for (const key of FLEET_KEYS) {
    const value = (delta.d as Record<string, unknown>)[key];
    if (value !== undefined) {
      d[key] = value;
      any = true;
    }
  }
  return any ? { s: delta.s, q: delta.q, t: delta.t, d: d as TmDelta['d'] } : null;
}
