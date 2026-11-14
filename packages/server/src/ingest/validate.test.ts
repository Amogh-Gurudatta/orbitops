import { describe, expect, it } from 'vitest';
import { MAX_FUTURE_SKEW_MS, MAX_PAST_AGE_MS } from '@orbitops/shared';
import { event } from '../testing/factories.js';
import { validateBatch } from './validate.js';

const NOW = 1_700_000_000_000;

describe('validateBatch', () => {
  it('accepts a well-formed batch and extracts the satellite id', () => {
    const result = validateBatch(
      { sourceId: 'sat-25544', events: [event(1, NOW), event(2, NOW)] },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batch.satId).toBe(25544);
      expect(result.batch.events).toHaveLength(2);
      expect(result.batch.malformed).toBe(0);
    }
  });

  it('rejects a broken envelope', () => {
    expect(validateBatch(null, NOW).ok).toBe(false);
    expect(validateBatch({ sourceId: 'bad', events: [event(1, NOW)] }, NOW).ok).toBe(false);
    expect(validateBatch({ sourceId: 'sat-1', events: [] }, NOW).ok).toBe(false);
    expect(validateBatch({ sourceId: 'sat-1', events: [event(1, NOW)], extra: 1 }, NOW).ok).toBe(
      false,
    );
  });

  it('counts malformed events without discarding the rest of the batch', () => {
    const bad = { ...event(2, NOW), data: { lat: 'x' } };
    const result = validateBatch({ sourceId: 'sat-1', events: [event(1, NOW), bad, 'junk'] }, NOW);
    expect(result.ok && result.batch.events.map((e) => e.seq)).toEqual([1]);
    expect(result.ok && result.batch.malformed).toBe(2);
    expect(result.ok && result.batch.total).toBe(3);
  });

  it('enforces the timestamp window', () => {
    const events = [
      event(1, NOW + MAX_FUTURE_SKEW_MS), // edge: allowed
      event(2, NOW + MAX_FUTURE_SKEW_MS + 1),
      event(3, NOW - MAX_PAST_AGE_MS), // edge: allowed
      event(4, NOW - MAX_PAST_AGE_MS - 1),
    ];
    const result = validateBatch({ sourceId: 'sat-1', events }, NOW);
    expect(result.ok && result.batch.events.map((e) => e.seq)).toEqual([1, 3]);
  });
});
