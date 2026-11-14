// Central stats collector. Pipeline stages bump counters; once a second `tick()` turns them into rates
// and a PipelineStats snapshot that feeds SERVER_STATS, /metrics and the system REST endpoint.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { RollingWindow } from './percentiles.js';

/** Sampling interval of the event-loop delay histogram. */
const LOOP_RESOLUTION_MS = 10;

export const COUNTER_NAMES = [
  'accepted',
  'duplicates',
  'outOfOrder',
  'late',
  'malformed',
  'rateLimited',
  'dropped',
  'persisted',
  'messages',
  'bytes',
  'gapsSkipped',
] as const;
export type CounterName = (typeof COUNTER_NAMES)[number];

export interface CounterSink {
  inc(name: CounterName, n?: number): void;
}

export interface PipelineStats {
  ts: number;
  uptimeS: number;
  ingest: {
    eventsPerSec: number;
    accepted: number;
    duplicates: number;
    outOfOrder: number;
    late: number;
    malformed: number;
    rateLimited: number;
    dropped: number;
  };
  broadcast: { msgsPerSec: number; bytesPerSec: number; slowConsumers: number };
  store: { queueDepth: number; flushMsP50: number; flushMsP99: number; persisted: number };
  clients: { telemetry: number; alerts: number; ingest: number };
  eventLoop: { p50Ms: number; p99Ms: number };
  latency: { p50: number; p95: number; p99: number };
  memory: { rssMb: number; heapMb: number };
}

export interface LatencyReport {
  p50: number;
  p95: number;
  p99: number;
  n: number;
}

/** Live gauges owned by other modules; wired in at boot. */
export interface StatsProviders {
  clients(): { telemetry: number; alerts: number; ingest: number };
  queueDepth(): number;
  slowConsumers(): number;
}

const NO_PROVIDERS: StatsProviders = {
  clients: () => ({ telemetry: 0, alerts: 0, ingest: 0 }),
  queueDepth: () => 0,
  slowConsumers: () => 0,
};

const LATENCY_REPORT_TTL_MS = 30_000;
const round = (n: number, digits = 1): number => Math.round(n * 10 ** digits) / 10 ** digits;

export class StatsCollector implements CounterSink {
  private readonly totals: Record<CounterName, number> = Object.fromEntries(
    COUNTER_NAMES.map((n) => [n, 0]),
  ) as Record<CounterName, number>;
  private readonly startedAt: number;
  private lastTickAt: number;
  private lastTotals = { ...this.totals };
  private readonly flushMs = new RollingWindow(256);
  private readonly latencyReports = new Map<string, { report: LatencyReport; at: number }>();
  private readonly loopDelay: ReturnType<typeof monitorEventLoopDelay> = monitorEventLoopDelay({
    resolution: LOOP_RESOLUTION_MS,
  });
  private providers: StatsProviders = NO_PROVIDERS;
  private rates = { eventsPerSec: 0, msgsPerSec: 0, bytesPerSec: 0 };
  private latest: PipelineStats;
  /** Observer for the Prometheus flush-duration histogram. */
  onFlushObserved: ((ms: number) => void) | undefined;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = this.lastTickAt = this.now();
    this.loopDelay.enable();
    this.latest = this.build(this.now());
  }

  setProviders(providers: StatsProviders): void {
    this.providers = providers;
  }

  inc(name: CounterName, n = 1): void {
    this.totals[name] += n;
  }

  total(name: CounterName): number {
    return this.totals[name];
  }

  recordFlush(ms: number, docs: number): void {
    this.flushMs.add(ms);
    this.totals.persisted += docs;
    this.onFlushObserved?.(ms);
  }

  /** Latest latency percentiles (ms, render - ts) reported by one client socket. */
  recordLatency(socketId: string, report: LatencyReport): void {
    this.latencyReports.set(socketId, { report, at: this.now() });
  }

  forgetClient(socketId: string): void {
    this.latencyReports.delete(socketId);
  }

  /** Recomputes rates and the snapshot. Call once per second. */
  tick(): PipelineStats {
    const now = this.now();
    const dt = Math.max(0.001, (now - this.lastTickAt) / 1000);
    const per = (name: CounterName) => (this.totals[name] - this.lastTotals[name]) / dt;
    this.rates = {
      eventsPerSec: per('accepted'),
      msgsPerSec: per('messages'),
      bytesPerSec: per('bytes'),
    };
    this.lastTotals = { ...this.totals };
    this.lastTickAt = now;
    this.latest = this.build(now);
    this.loopDelay.reset();
    return this.latest;
  }

  snapshot(): PipelineStats {
    return this.latest;
  }

  stop(): void {
    this.loopDelay.disable();
  }

  /**
   * Event loop lag percentiles in ms since the last tick. The histogram records the full interval
   * between its sampling timer firings (ns), so the sampling resolution is subtracted to get the lag.
   */
  private eventLoop(): { p50Ms: number; p99Ms: number } {
    const h = this.loopDelay;
    if (h.count === 0) return { p50Ms: 0, p99Ms: 0 };
    const lagMs = (p: number) => round(Math.max(0, h.percentile(p) / 1e6 - LOOP_RESOLUTION_MS), 2);
    return { p50Ms: lagMs(50), p99Ms: lagMs(99) };
  }

  /** Sample-weighted mean of each client's percentiles; fresh reports only. */
  private latency(now: number): PipelineStats['latency'] {
    let n = 0;
    const sum = { p50: 0, p95: 0, p99: 0 };
    for (const [id, { report, at }] of this.latencyReports) {
      if (now - at > LATENCY_REPORT_TTL_MS) {
        this.latencyReports.delete(id);
        continue;
      }
      n += report.n;
      sum.p50 += report.p50 * report.n;
      sum.p95 += report.p95 * report.n;
      sum.p99 += report.p99 * report.n;
    }
    if (n === 0) return { p50: 0, p95: 0, p99: 0 };
    return { p50: round(sum.p50 / n), p95: round(sum.p95 / n), p99: round(sum.p99 / n) };
  }

  private build(now: number): PipelineStats {
    const mem = process.memoryUsage();
    const t = this.totals;
    return {
      ts: now,
      uptimeS: Math.round((now - this.startedAt) / 1000),
      ingest: {
        eventsPerSec: round(this.rates.eventsPerSec),
        accepted: t.accepted,
        duplicates: t.duplicates,
        outOfOrder: t.outOfOrder,
        late: t.late,
        malformed: t.malformed,
        rateLimited: t.rateLimited,
        dropped: t.dropped,
      },
      broadcast: {
        msgsPerSec: round(this.rates.msgsPerSec),
        bytesPerSec: Math.round(this.rates.bytesPerSec),
        slowConsumers: this.providers.slowConsumers(),
      },
      store: {
        queueDepth: this.providers.queueDepth(),
        flushMsP50: round(this.flushMs.percentile(50)),
        flushMsP99: round(this.flushMs.percentile(99)),
        persisted: t.persisted,
      },
      clients: this.providers.clients(),
      eventLoop: this.eventLoop(),
      latency: this.latency(now),
      memory: { rssMb: round(mem.rss / 1048576), heapMb: round(mem.heapUsed / 1048576) },
    };
  }
}
