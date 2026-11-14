// Telemetry contracts: one sample (frame), the event wrapper, and the ingest batch envelope.
import { z } from 'zod';
import { MAX_EVENTS_PER_BATCH } from './constants.js';

export const SPACECRAFT_MODES = ['NOMINAL', 'SAFE', 'ECLIPSE', 'DEGRADED', 'LOS'] as const;
export type SpacecraftMode = (typeof SPACECRAFT_MODES)[number];

/** All numeric fields are finite (z.number() rejects NaN/Infinity) and range-checked. */
export const TelemetryFrame = z.strictObject({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altKm: z.number().min(0).max(100_000),
  velKms: z.number().min(0).max(15),
  /** Fraction of the solar disc hidden by Earth: 0 = full sun, 1 = full umbra. */
  shadow: z.number().min(0).max(1),
  solarW: z.number().min(0).max(10_000),
  batSoc: z.number().min(0).max(1),
  batV: z.number().min(0).max(100),
  busA: z.number().min(-100).max(100),
  panelTempC: z.number().min(-273.15).max(500),
  obcTempC: z.number().min(-273.15).max(500),
  rssiDbm: z.number().min(-200).max(0).nullable(),
  snrDb: z.number().min(-50).max(100).nullable(),
  stationId: z.string().min(1).max(64).nullable(),
  elevDeg: z.number().min(-90).max(90).nullable(),
  attRateDps: z.number().min(0).max(1000),
  propKg: z.number().min(0).max(100_000),
  mode: z.enum(SPACECRAFT_MODES),
});
export type TelemetryFrame = z.infer<typeof TelemetryFrame>;
export type TelemetryMetric = keyof TelemetryFrame;

export const TelemetryEvent = z.strictObject({
  seq: z.int().min(0),
  /** Sample time, epoch milliseconds. */
  ts: z.int().min(0),
  type: z.literal('tm'),
  data: TelemetryFrame,
});
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

export const SOURCE_ID_PATTERN = /^sat-\d{1,9}$/;
export const SourceId = z.string().regex(SOURCE_ID_PATTERN);

/**
 * Envelope only: the server validates each event on its own (with `TelemetryEvent`)
 * so a single malformed event cannot discard the rest of a batch.
 */
export const IngestBatchEnvelope = z.strictObject({
  sourceId: SourceId,
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type IngestBatchEnvelope = z.infer<typeof IngestBatchEnvelope>;

/** Fully typed batch, for producers and tests that want strict end-to-end validation. */
export const IngestBatch = z.strictObject({
  sourceId: SourceId,
  events: z.array(TelemetryEvent).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type IngestBatch = z.infer<typeof IngestBatch>;

export const IngestAck = z.strictObject({
  ok: z.boolean(),
  accepted: z.int().min(0),
  duplicates: z.int().min(0),
  rejected: z.int().min(0),
  /** Set when the server asks the producer to slow down (backpressure). */
  retryAfterMs: z.int().min(0).optional(),
});
export type IngestAck = z.infer<typeof IngestAck>;

/** `sat-25544` -> 25544, or null when the id is malformed. */
export function satIdFromSourceId(sourceId: string): number | null {
  return SOURCE_ID_PATTERN.test(sourceId) ? Number(sourceId.slice(4)) : null;
}

export function sourceIdFromSatId(satId: number): string {
  return `sat-${satId}`;
}
