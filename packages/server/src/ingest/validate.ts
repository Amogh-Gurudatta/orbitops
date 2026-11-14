// Stage 1: structural validation. The envelope must parse; each event is checked on its own so one
// malformed event never discards the rest of the batch. Events outside the time window are malformed too.
import {
  IngestBatchEnvelope,
  MAX_FUTURE_SKEW_MS,
  MAX_PAST_AGE_MS,
  TelemetryEvent,
  satIdFromSourceId,
} from '@orbitops/shared';

export interface ValidBatch {
  sourceId: string;
  satId: number;
  /** Events that passed schema and time-window checks, in arrival order. */
  events: TelemetryEvent[];
  /** Events in the envelope, valid or not. */
  total: number;
  malformed: number;
}

export type ValidationResult = { ok: true; batch: ValidBatch } | { ok: false; reason: 'envelope' };

export function isWithinTimeWindow(ts: number, now: number): boolean {
  return ts <= now + MAX_FUTURE_SKEW_MS && ts >= now - MAX_PAST_AGE_MS;
}

export function validateBatch(raw: unknown, now: number): ValidationResult {
  const envelope = IngestBatchEnvelope.safeParse(raw);
  if (!envelope.success) return { ok: false, reason: 'envelope' };
  const { sourceId, events: rawEvents } = envelope.data;
  const satId = satIdFromSourceId(sourceId);
  if (satId === null) return { ok: false, reason: 'envelope' };

  const events: TelemetryEvent[] = [];
  for (const candidate of rawEvents) {
    const parsed = TelemetryEvent.safeParse(candidate);
    if (parsed.success && isWithinTimeWindow(parsed.data.ts, now)) events.push(parsed.data);
  }
  return {
    ok: true,
    batch: {
      sourceId,
      satId,
      events,
      total: rawEvents.length,
      malformed: rawEvents.length - events.length,
    },
  };
}
