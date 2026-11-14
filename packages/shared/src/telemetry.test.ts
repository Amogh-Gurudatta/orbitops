import { describe, expect, it } from 'vitest';
import { MAX_EVENTS_PER_BATCH } from './constants.js';
import { validEvent, validFrame } from './fixtures.js';
import {
  IngestBatch,
  IngestBatchEnvelope,
  TelemetryEvent,
  satIdFromSourceId,
  sourceIdFromSatId,
} from './telemetry.js';

describe('TelemetryEvent', () => {
  it('accepts a valid event, including null link fields', () => {
    expect(TelemetryEvent.safeParse(validEvent).success).toBe(true);
    const noLink = {
      ...validEvent,
      data: { ...validFrame, rssiDbm: null, snrDb: null, stationId: null, elevDeg: null },
    };
    expect(TelemetryEvent.safeParse(noLink).success).toBe(true);
  });

  it.each([
    ['latitude out of bounds', { ...validEvent, data: { ...validFrame, lat: 91 } }],
    ['NaN value', { ...validEvent, data: { ...validFrame, batV: Number.NaN } }],
    ['Infinity value', { ...validEvent, data: { ...validFrame, solarW: Infinity } }],
    ['battery SoC above 1', { ...validEvent, data: { ...validFrame, batSoc: 1.2 } }],
    ['unknown mode', { ...validEvent, data: { ...validFrame, mode: 'BOGUS' } }],
    ['extra key in frame', { ...validEvent, data: { ...validFrame, extra: 1 } }],
    ['extra key in event', { ...validEvent, extra: 1 }],
    ['missing field', { ...validEvent, data: { ...validFrame, lat: undefined } }],
    ['negative seq', { ...validEvent, seq: -1 }],
    ['fractional ts', { ...validEvent, ts: 1.5 }],
    ['wrong type literal', { ...validEvent, type: 'other' }],
  ])('rejects %s', (_name, event) => {
    expect(TelemetryEvent.safeParse(event).success).toBe(false);
  });
});

describe('ingest batches', () => {
  it('accepts a valid batch', () => {
    expect(IngestBatch.safeParse({ sourceId: 'sat-25544', events: [validEvent] }).success).toBe(
      true,
    );
  });

  it.each(['sat-', 'sat-abc', 'sat-1234567890', 'sensor-1', 'SAT-1', ''])(
    'rejects bad sourceId %j',
    (sourceId) => {
      expect(IngestBatch.safeParse({ sourceId, events: [validEvent] }).success).toBe(false);
    },
  );

  it('rejects extra keys, empty and oversized batches', () => {
    expect(
      IngestBatch.safeParse({ sourceId: 'sat-1', events: [validEvent], extra: true }).success,
    ).toBe(false);
    expect(IngestBatch.safeParse({ sourceId: 'sat-1', events: [] }).success).toBe(false);
    const tooMany = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => validEvent);
    expect(IngestBatchEnvelope.safeParse({ sourceId: 'sat-1', events: tooMany }).success).toBe(
      false,
    );
  });

  it('envelope lets malformed events through so they can be validated one by one', () => {
    const batch = { sourceId: 'sat-1', events: [validEvent, { garbage: true }] };
    expect(IngestBatchEnvelope.safeParse(batch).success).toBe(true);
    expect(IngestBatch.safeParse(batch).success).toBe(false);
  });
});

describe('source id helpers', () => {
  it('converts both ways', () => {
    expect(sourceIdFromSatId(25544)).toBe('sat-25544');
    expect(satIdFromSourceId('sat-25544')).toBe(25544);
    expect(satIdFromSourceId('nope')).toBeNull();
  });
});
