// Payload size comparison for the "compact deltas" explainer: the same telemetry update as
// MessagePack-encoded short-key delta (what the server sends) versus naive JSON of the full frame.
import { encode } from '@msgpack/msgpack';
import { encodeFrame, type TelemetryFrame } from '@orbitops/shared';
import type { LatestUpdate } from '../../realtime/protocol.ts';

export interface PayloadSizes {
  /** msgpack of `{ s, q, t, d }` with short keys and only changed fields. */
  compactDelta: number;
  /** JSON of the same changed fields with long field names. */
  jsonDelta: number;
  /** JSON of the whole event envelope with every field, the naive per-sample broadcast. */
  jsonFull: number;
  /** The compact delta as it appears on the wire. */
  wire: { s: number; q: number; t: number; d: Record<string, unknown> };
}

const utf8 = new TextEncoder();
const jsonBytes = (value: unknown) => utf8.encode(JSON.stringify(value)).length;

export function payloadSizes(
  update: Pick<LatestUpdate, 'satId' | 'seq' | 't' | 'frame'>,
  fullFrame: Partial<TelemetryFrame>,
): PayloadSizes {
  const wire = { s: update.satId, q: update.seq, t: update.t, d: encodeFrame(update.frame) };
  return {
    compactDelta: encode(wire).byteLength,
    jsonDelta: jsonBytes({
      satId: update.satId,
      seq: update.seq,
      ts: update.t,
      data: update.frame,
    }),
    jsonFull: jsonBytes({
      sourceId: `sat-${update.satId}`,
      seq: update.seq,
      ts: update.t,
      type: 'tm',
      data: { ...fullFrame, ...update.frame },
    }),
    wire,
  };
}

/** Share of the naive size saved, 0..1 (0 when the baseline is empty). */
export const savedFraction = (compact: number, baseline: number): number =>
  baseline > 0 ? Math.max(0, 1 - compact / baseline) : 0;
