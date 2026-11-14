// Five-minute client-side history of the server's PipelineStats, kept in fixed-size ring arrays so
// memory stays flat however long the page is open. Pure and unit-tested.
import type { PipelineStats } from '../../api/types.ts';

export const HISTORY_SECONDS = 300;

/** Fixed-capacity ring of numbers; `values()` returns oldest -> newest. */
export class SeriesRing {
  private readonly data: Float64Array;
  private next = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(value: number): void {
    this.data[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  values(): number[] {
    const out = new Array<number>(this.size);
    const start = (this.next - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) out[i] = this.data[(start + i) % this.capacity]!;
    return out;
  }
}

/** Every plotted / tabulated series, with how to read it out of a PipelineStats sample. */
export const STAT_READERS = {
  eventsPerSec: (s) => s.ingest.eventsPerSec,
  accepted: (s) => s.ingest.accepted,
  duplicates: (s) => s.ingest.duplicates,
  outOfOrder: (s) => s.ingest.outOfOrder,
  late: (s) => s.ingest.late,
  malformed: (s) => s.ingest.malformed,
  rateLimited: (s) => s.ingest.rateLimited,
  dropped: (s) => s.ingest.dropped,
  msgsPerSec: (s) => s.broadcast.msgsPerSec,
  bytesPerSec: (s) => s.broadcast.bytesPerSec,
  bytesPerMsg: (s) =>
    s.broadcast.msgsPerSec > 0 ? s.broadcast.bytesPerSec / s.broadcast.msgsPerSec : 0,
  slowConsumers: (s) => s.broadcast.slowConsumers,
  queueDepth: (s) => s.store.queueDepth,
  flushMsP50: (s) => s.store.flushMsP50,
  flushMsP99: (s) => s.store.flushMsP99,
  persisted: (s) => s.store.persisted,
  loopP50: (s) => s.eventLoop.p50Ms,
  loopP99: (s) => s.eventLoop.p99Ms,
  rssMb: (s) => s.memory.rssMb,
  heapMb: (s) => s.memory.heapMb,
  latP50: (s) => s.latency.p50,
  latP95: (s) => s.latency.p95,
  latP99: (s) => s.latency.p99,
} as const satisfies Record<string, (s: PipelineStats) => number>;

export type StatKey = keyof typeof STAT_READERS;
const KEYS = Object.keys(STAT_READERS) as StatKey[];

export class StatsHistory {
  private readonly times: SeriesRing;
  private readonly rings: Record<StatKey, SeriesRing>;
  private lastTs = -Infinity;

  constructor(capacity = HISTORY_SECONDS) {
    this.times = new SeriesRing(capacity);
    this.rings = Object.fromEntries(KEYS.map((k) => [k, new SeriesRing(capacity)])) as Record<
      StatKey,
      SeriesRing
    >;
  }

  get length(): number {
    return this.times.length;
  }

  /** Returns false (and records nothing) for a repeated or out-of-order sample. */
  record(stats: PipelineStats): boolean {
    if (stats.ts <= this.lastTs) return false;
    this.lastTs = stats.ts;
    this.times.push(stats.ts / 1000);
    for (const key of KEYS) this.rings[key].push(STAT_READERS[key](stats));
    return true;
  }

  /** Sample times, epoch seconds. */
  t(): number[] {
    return this.times.values();
  }

  series(key: StatKey): number[] {
    return this.rings[key].values();
  }

  /** Latest value of a series, or 0 before the first sample. */
  latest(key: StatKey): number {
    return this.rings[key].values().at(-1) ?? 0;
  }

  /**
   * Per-second rate of a cumulative counter between consecutive samples (length = samples - 1).
   * A counter reset (server restart) reads as 0 rather than a huge negative spike.
   */
  rates(key: StatKey): number[] {
    const t = this.t();
    const v = this.series(key);
    const out: number[] = [];
    for (let i = 1; i < v.length; i++) {
      const dt = t[i]! - t[i - 1]!;
      out.push(dt > 0 ? Math.max(0, v[i]! - v[i - 1]!) / dt : 0);
    }
    return out;
  }

  /** Latest per-second rate of a counter. */
  latestRate(key: StatKey): number {
    return this.rates(key).at(-1) ?? 0;
  }
}
