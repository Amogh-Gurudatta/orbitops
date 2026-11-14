import { TelemetryEvent, type TelemetryEvent as Event } from '@orbitops/shared';
import { describe, expect, it } from 'vitest';
import { Chaos } from './chaos.js';
import { mulberry32 } from './prng.js';

function makeEvent(seq: number): Event {
  return {
    seq,
    ts: 1_700_000_000_000 + seq,
    type: 'tm',
    data: {
      lat: 10,
      lon: 20,
      altKm: 400,
      velKms: 7.6,
      shadow: 0,
      solarW: 300,
      batSoc: 0.8,
      batV: 28,
      busA: 3,
      panelTempC: 40,
      obcTempC: 25,
      rssiDbm: -100,
      snrDb: 10,
      stationId: 'SVAL',
      elevDeg: 20,
      attRateDps: 0.05,
      propKg: 10,
      mode: 'NOMINAL',
    },
  };
}

describe('Chaos', () => {
  it('is a pass-through when disabled', () => {
    const chaos = new Chaos(mulberry32(1));
    const events = [makeEvent(1), makeEvent(2)];
    expect(chaos.apply('sat-1', events)).toEqual(events);
    expect(chaos.counts).toEqual({ duplicates: 0, reordered: 0, malformed: 0 });
  });

  it('injects duplicates, reordering and malformed events at roughly the configured rates', () => {
    const chaos = new Chaos(mulberry32(42));
    chaos.configure({ enabled: true, duplicateRate: 0.2, reorderRate: 0.2, malformedRate: 0.1 });

    const input: Event[] = [];
    const wire: unknown[] = [];
    const batchSize = 5;
    const total = 5000;
    for (let seq = 0; seq < total; seq += batchSize) {
      const batch = Array.from({ length: batchSize }, (_, i) => makeEvent(seq + i));
      input.push(...batch);
      const out = chaos.apply('sat-1', batch);
      expect(out.length).toBeGreaterThan(0);
      wire.push(...out);
    }

    const { duplicates, reordered, malformed } = chaos.counts;
    expect(duplicates / total).toBeGreaterThan(0.17);
    expect(duplicates / total).toBeLessThan(0.23);
    expect(malformed / total).toBeGreaterThan(0.08);
    expect(malformed / total).toBeLessThan(0.12);
    expect(reordered / (total + duplicates)).toBeGreaterThan(0.17);
    expect(reordered / (total + duplicates)).toBeLessThan(0.23);

    // What is observable on the wire matches the counters.
    const invalid = wire.filter((e) => !TelemetryEvent.safeParse(e).success);
    // Events still being delayed when the loop ends have not reached the wire yet.
    expect(invalid.length).toBeLessThanOrEqual(malformed);
    expect(invalid.length).toBeGreaterThan(malformed - 10);
    const seqs = wire
      .filter((e) => TelemetryEvent.safeParse(e).success)
      .map((e) => (e as Event).seq);
    expect(new Set(seqs).size).toBeLessThan(seqs.length);
    expect(seqs.filter((s, i) => i > 0 && s < seqs[i - 1]!).length).toBeGreaterThan(total * 0.05);

    // The caller's own events are never corrupted.
    expect(input.every((e) => TelemetryEvent.safeParse(e).success)).toBe(true);
  });

  it('delays events to a later batch but never drops them silently', () => {
    const chaos = new Chaos(mulberry32(7));
    chaos.configure({ enabled: true, duplicateRate: 0, reorderRate: 0.5, malformedRate: 0 });
    const seen = new Set<number>();
    for (let seq = 0; seq < 400; seq += 4) {
      const out = chaos.apply(
        'sat-1',
        [0, 1, 2, 3].map((i) => makeEvent(seq + i)),
      );
      out.forEach((e) => seen.add((e as Event).seq));
    }
    expect(seen.size).toBeGreaterThan(380);
  });
});
