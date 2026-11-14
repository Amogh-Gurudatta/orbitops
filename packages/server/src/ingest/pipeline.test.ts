import { describe, expect, it } from 'vitest';
import type { SatGroup, TelemetryEvent } from '@orbitops/shared';
import type { AlertTransition } from '../anomaly/index.js';
import type { DeviceIdentity } from '../auth/deviceKey.js';
import type { CounterName } from '../metrics/collector.js';
import { event, frame } from '../testing/factories.js';
import type { Sample } from '../store/writer.js';
import { IngestPipeline } from './pipeline.js';

const DEVICE: DeviceIdentity = { id: 'dev1', name: 'sim', allowedSources: ['*'] };
const NOW = 1_700_000_000_000;

function harness(options: { retryAfterMs?: number; fill?: number } = {}) {
  let now = NOW;
  const counters: Record<string, number> = {};
  const applied: { satId: number; seq: number }[] = [];
  const evaluated: number[] = [];
  const persisted: Sample[] = [];
  const transitions: AlertTransition[][] = [];
  const pipeline = new IngestPipeline({
    now: () => now,
    limiter: { consume: async () => options.retryAfterMs ?? 0 },
    state: { apply: (satId, seq) => void applied.push({ satId, seq }) },
    anomaly: {
      evaluate: (satId) => {
        evaluated.push(satId);
        return evaluated.length === 1
          ? [{ kind: 'open', key: '1:r', satId, ruleId: 'r' } as AlertTransition]
          : [];
      },
    },
    groupOf: (satId): SatGroup | undefined => (satId === 1 || satId === 2 ? 'weather' : undefined),
    persist: (s) => void persisted.push(s),
    onTransitions: (t) => void transitions.push(t),
    counters: {
      inc: (name: CounterName, n = 1) => void (counters[name] = (counters[name] ?? 0) + n),
    },
    writerFill: () => options.fill ?? 0,
  });
  const batch = (events: unknown[], sourceId = 'sat-1') =>
    pipeline.ingest(DEVICE, { sourceId, events });
  const ev = (seq: number): TelemetryEvent => event(seq, NOW);
  return {
    pipeline,
    counters,
    applied,
    evaluated,
    persisted,
    transitions,
    batch,
    ev,
    advance: (ms: number) => void (now += ms),
  };
}

describe('IngestPipeline', () => {
  it('runs in-order events through state, anomaly and persistence and acks them', async () => {
    const h = harness();
    const ack = await h.batch([h.ev(1), h.ev(2), h.ev(3)]);
    expect(ack).toEqual({ ok: true, accepted: 3, duplicates: 0, rejected: 0 });
    expect(h.applied.map((a) => a.seq)).toEqual([1, 2, 3]);
    expect(h.persisted.map((p) => [p.seq, p.late, p.group])).toEqual([
      [1, false, 'weather'],
      [2, false, 'weather'],
      [3, false, 'weather'],
    ]);
    expect(h.transitions).toHaveLength(1);
    expect(h.counters.accepted).toBe(3);
  });

  it('reports duplicates and does not process them twice', async () => {
    const h = harness();
    await h.batch([h.ev(1), h.ev(2)]);
    const ack = await h.batch([h.ev(2), h.ev(2), h.ev(3)]);
    expect(ack).toMatchObject({ accepted: 1, duplicates: 2 });
    expect(h.applied.map((a) => a.seq)).toEqual([1, 2, 3]);
    expect(h.counters.duplicates).toBe(2);
  });

  it('reorders out-of-order events within the hold window', async () => {
    const h = harness();
    await h.batch([h.ev(1), h.ev(3), h.ev(2)]);
    expect(h.applied.map((a) => a.seq)).toEqual([1, 2, 3]);
    expect(h.counters.outOfOrder).toBe(1);
  });

  it('persists late events with the late flag but does not touch live state', async () => {
    const h = harness();
    await h.batch([h.ev(5), h.ev(6)]);
    h.advance(1);
    await h.batch([h.ev(4)]);
    expect(h.applied.map((a) => a.seq)).toEqual([5, 6]);
    expect(h.evaluated).toHaveLength(2);
    expect(h.persisted.at(-1)).toMatchObject({ seq: 4, late: true });
    expect(h.counters.late).toBe(1);
  });

  it('skips a gap once the hold expires (via tick) and counts it', async () => {
    const h = harness();
    await h.batch([h.ev(1), h.ev(4)]);
    expect(h.applied.map((a) => a.seq)).toEqual([1]);
    h.advance(300);
    h.pipeline.tick();
    expect(h.applied.map((a) => a.seq)).toEqual([1, 4]);
    expect(h.counters.gapsSkipped).toBe(2);
  });

  it('counts malformed events but keeps the valid ones', async () => {
    const h = harness();
    const ack = await h.batch([
      h.ev(1),
      { seq: 2, ts: NOW, type: 'tm', data: frame({ lat: 999 }) },
    ]);
    expect(ack).toEqual({ ok: true, accepted: 1, duplicates: 0, rejected: 1 });
    expect(h.counters.malformed).toBe(1);
  });

  it('rejects a bad envelope, unknown satellites and unauthorised sources', async () => {
    const h = harness();
    expect(await h.pipeline.ingest(DEVICE, { nope: 1 })).toMatchObject({ ok: false, rejected: 1 });
    expect(await h.batch([h.ev(1)], 'sat-999')).toMatchObject({ ok: false, rejected: 1 });
    const limited: DeviceIdentity = { id: 'd2', name: 'x', allowedSources: ['sat-2'] };
    const ack = await h.pipeline.ingest(limited, { sourceId: 'sat-1', events: [h.ev(1)] });
    expect(ack.ok).toBe(false);
    expect(h.applied).toEqual([]);
  });

  it('answers a rate-limited batch with retryAfterMs and processes nothing', async () => {
    const h = harness({ retryAfterMs: 400 });
    const ack = await h.batch([h.ev(1), h.ev(2)]);
    expect(ack).toEqual({ ok: false, accepted: 0, duplicates: 0, rejected: 0, retryAfterMs: 400 });
    expect(h.counters.rateLimited).toBe(2);
    expect(h.applied).toEqual([]);
  });

  it('asks producers to slow down when the write queue is nearly full', async () => {
    const h = harness({ fill: 0.9 });
    expect((await h.batch([h.ev(1)])).retryAfterMs).toBeGreaterThan(0);
  });

  it('keeps sources independent', async () => {
    const h = harness();
    await h.batch([h.ev(1), h.ev(2)], 'sat-1');
    await h.batch([h.ev(1)], 'sat-2');
    expect(h.applied.filter((a) => a.satId === 2)).toHaveLength(1);
  });

  it('accepts a restarted source whose seq jumped forward or reset backwards', async () => {
    const h = harness();
    await h.batch([h.ev(100), h.ev(101)]);
    await h.batch([h.ev(50_000)]);
    expect(h.applied.at(-1)?.seq).toBe(50_000);
    // Counter reset: far below the watermark but with a newer timestamp.
    h.advance(10_000);
    const restarted = await h.batch([event(3, NOW + 10_000)]);
    expect(restarted.accepted).toBe(1);
    expect(h.applied.at(-1)?.seq).toBe(3);
  });
});
