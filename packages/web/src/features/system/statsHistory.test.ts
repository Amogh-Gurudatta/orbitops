import { describe, expect, it } from 'vitest';
import type { PipelineStats } from '../../api/types.ts';
import { SeriesRing, StatsHistory } from './statsHistory.ts';

function stats(
  ts: number,
  over: { accepted?: number; msgs?: number; bytes?: number } = {},
): PipelineStats {
  return {
    ts,
    uptimeS: 1,
    ingest: {
      eventsPerSec: 320,
      accepted: over.accepted ?? 0,
      duplicates: 0,
      outOfOrder: 0,
      late: 0,
      malformed: 0,
      rateLimited: 0,
      dropped: 0,
    },
    broadcast: { msgsPerSec: over.msgs ?? 2, bytesPerSec: over.bytes ?? 3000, slowConsumers: 0 },
    store: { queueDepth: 0, flushMsP50: 1, flushMsP99: 2, persisted: 0 },
    clients: { telemetry: 1, alerts: 1, ingest: 1 },
    eventLoop: { p50Ms: 1, p99Ms: 2 },
    latency: { p50: 10, p95: 20, p99: 30 },
    memory: { rssMb: 200, heapMb: 60 },
  };
}

describe('SeriesRing', () => {
  it('returns values oldest to newest and overwrites past capacity', () => {
    const ring = new SeriesRing(3);
    [1, 2].forEach((v) => ring.push(v));
    expect(ring.values()).toEqual([1, 2]);
    [3, 4, 5].forEach((v) => ring.push(v));
    expect(ring.values()).toEqual([3, 4, 5]);
    expect(ring.length).toBe(3);
  });
});

describe('StatsHistory', () => {
  it('caps memory at the configured window', () => {
    const history = new StatsHistory(5);
    for (let i = 1; i <= 12; i++) history.record(stats(i * 1000));
    expect(history.length).toBe(5);
    expect(history.t()).toEqual([8, 9, 10, 11, 12]);
  });

  it('ignores repeated and older samples', () => {
    const history = new StatsHistory(5);
    expect(history.record(stats(2000))).toBe(true);
    expect(history.record(stats(2000))).toBe(false);
    expect(history.record(stats(1000))).toBe(false);
    expect(history.length).toBe(1);
  });

  it('derives per-second counter rates and clamps counter resets', () => {
    const history = new StatsHistory(10);
    history.record(stats(1000, { accepted: 100 }));
    history.record(stats(2000, { accepted: 400 }));
    history.record(stats(4000, { accepted: 1000 }));
    history.record(stats(5000, { accepted: 10 }));
    expect(history.rates('accepted')).toEqual([300, 300, 0]);
    expect(history.latestRate('accepted')).toBe(0);
  });

  it('derives bytes per message and tolerates zero messages', () => {
    const history = new StatsHistory(10);
    history.record(stats(1000, { msgs: 2, bytes: 3000 }));
    history.record(stats(2000, { msgs: 0, bytes: 0 }));
    expect(history.series('bytesPerMsg')).toEqual([1500, 0]);
  });
});
