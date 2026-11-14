import { afterEach, describe, expect, it } from 'vitest';
import { StatsCollector } from './collector.js';
import { RollingWindow } from './percentiles.js';

describe('RollingWindow', () => {
  it('computes nearest-rank percentiles over the newest samples', () => {
    const w = new RollingWindow(5);
    for (let i = 1; i <= 10; i++) w.add(i);
    expect(w.size).toBe(5);
    expect(w.percentile(50)).toBe(8);
    expect(w.percentile(100)).toBe(10);
    expect(new RollingWindow().percentile(50)).toBe(0);
  });
});

describe('StatsCollector', () => {
  let stats: StatsCollector | undefined;
  afterEach(() => stats?.stop());

  it('turns counters into per-second rates and snapshots', () => {
    let now = 1_000_000;
    stats = new StatsCollector(() => now);
    stats.setProviders({
      clients: () => ({ telemetry: 2, alerts: 1, ingest: 1 }),
      queueDepth: () => 7,
      slowConsumers: () => 1,
    });
    stats.inc('accepted', 500);
    stats.inc('duplicates', 5);
    stats.inc('messages', 100);
    stats.inc('bytes', 4000);
    stats.recordFlush(12, 50);
    now += 2000;
    const snap = stats.tick();
    expect(snap.ingest).toMatchObject({ eventsPerSec: 250, accepted: 500, duplicates: 5 });
    expect(snap.broadcast).toEqual({ msgsPerSec: 50, bytesPerSec: 2000, slowConsumers: 1 });
    expect(snap.store).toMatchObject({ queueDepth: 7, persisted: 50, flushMsP50: 12 });
    expect(snap.clients.telemetry).toBe(2);
  });

  it('weights client latency reports by sample count and expires stale ones', () => {
    let now = 0;
    stats = new StatsCollector(() => now);
    stats.recordLatency('a', { p50: 10, p95: 20, p99: 30, n: 100 });
    stats.recordLatency('b', { p50: 20, p95: 40, p99: 60, n: 100 });
    expect(stats.tick().latency).toEqual({ p50: 15, p95: 30, p99: 45 });
    now += 60_000;
    expect(stats.tick().latency).toEqual({ p50: 0, p95: 0, p99: 0 });
  });
});
