// Server-side measurement: the PipelineStats shape served by /system/stats, process CPU from /proc,
// and a 1 Hz sampler that turns the stream of samples into a compact window summary.
import { readFileSync } from 'node:fs';
import { fetchStats } from './api.js';

/** Subset of the server's PipelineStats that the load test reads. */
export interface PipelineStats {
  uptimeS: number;
  ingest: {
    eventsPerSec: number;
    accepted: number;
    duplicates: number;
    rateLimited: number;
    malformed: number;
    dropped: number;
  };
  broadcast: { msgsPerSec: number; bytesPerSec: number; slowConsumers: number };
  store: { queueDepth: number; persisted: number };
  clients: { telemetry: number; alerts: number; ingest: number };
  eventLoop: { p50Ms: number; p99Ms: number };
  memory: { rssMb: number; heapMb: number };
}

const CLOCK_TICKS_PER_SEC = 100; // USER_HZ on Linux

/** Cumulative user+system CPU seconds of a process, from /proc/<pid>/stat. */
export function processCpuSeconds(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  // Field 2 (comm) may contain spaces; everything after the last ')' is plain space-separated.
  const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return (Number(rest[11]) + Number(rest[12])) / CLOCK_TICKS_PER_SEC;
}

/** Cumulative [busy, total] jiffies across all CPUs, from the first line of /proc/stat. */
export function systemCpuJiffies(): [number, number] {
  const fields = readFileSync('/proc/stat', 'utf8')
    .split('\n')[0]!
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const total = fields.reduce((a, b) => a + b, 0);
  const idle = (fields[3] ?? 0) + (fields[4] ?? 0); // idle + iowait
  return [total - idle, total];
}

export interface Sample {
  /** Seconds since the sampler started. */
  t: number;
  stats: PipelineStats;
  /** Server process CPU: 100 = one full core. */
  serverCpuPct: number;
  /** Whole-machine CPU utilisation, 0-100. */
  systemCpuPct: number;
}

export class ServerSampler {
  readonly samples: Sample[] = [];
  private timer: NodeJS.Timeout | undefined;
  private readonly startedAt = Date.now();
  private lastCpu: number;
  private lastSys: [number, number];
  private lastAt = Date.now();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly pid: number,
  ) {
    this.lastCpu = processCpuSeconds(pid);
    this.lastSys = systemCpuJiffies();
  }

  start(): void {
    this.timer = setInterval(() => void this.sample(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async sample(): Promise<void> {
    try {
      const stats = await fetchStats(this.baseUrl, this.token);
      const now = Date.now();
      const cpu = processCpuSeconds(this.pid);
      const sys = systemCpuJiffies();
      const dt = (now - this.lastAt) / 1000;
      const serverCpuPct = ((cpu - this.lastCpu) / dt) * 100;
      const systemCpuPct =
        ((sys[0] - this.lastSys[0]) / Math.max(1, sys[1] - this.lastSys[1])) * 100;
      this.lastCpu = cpu;
      this.lastSys = sys;
      this.lastAt = now;
      this.samples.push({ t: (now - this.startedAt) / 1000, stats, serverCpuPct, systemCpuPct });
    } catch {
      // A missed sample under heavy load is itself informative: the window summary reports the count.
    }
  }

  /** Samples in the half-open time window [fromT, toT). */
  window(fromT: number, toT: number): Sample[] {
    return this.samples.filter((s) => s.t >= fromT && s.t < toT);
  }

  get elapsed(): number {
    return (Date.now() - this.startedAt) / 1000;
  }
}

const round = (n: number, digits = 1): number => Math.round(n * 10 ** digits) / 10 ** digits;
const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const maxOf = (xs: number[]): number => (xs.length === 0 ? 0 : Math.max(...xs));

export interface ServerWindowSummary {
  samples: number;
  ingestEventsPerSec: { mean: number; max: number };
  broadcastMsgsPerSec: { mean: number; max: number };
  broadcastMBps: { mean: number; max: number };
  cpuPct: { mean: number; max: number };
  systemCpuPct: { mean: number; max: number };
  rssMb: { max: number };
  eventLoopP99Ms: { mean: number; max: number };
  queueDepthMax: number;
  slowConsumersMax: number;
  telemetryClientsMax: number;
  /** Counter deltas across the window. */
  accepted: number;
  rateLimited: number;
  malformed: number;
  dropped: number;
}

export function summarizeWindow(window: Sample[]): ServerWindowSummary {
  const col = (pick: (s: Sample) => number): number[] => window.map(pick);
  const stat = (xs: number[], digits = 1) => ({
    mean: round(mean(xs), digits),
    max: round(maxOf(xs), digits),
  });
  const first = window[0]?.stats.ingest;
  const last = window[window.length - 1]?.stats.ingest;
  const delta = (key: 'accepted' | 'rateLimited' | 'malformed' | 'dropped'): number =>
    first && last ? last[key] - first[key] : 0;
  return {
    samples: window.length,
    ingestEventsPerSec: stat(col((s) => s.stats.ingest.eventsPerSec)),
    broadcastMsgsPerSec: stat(col((s) => s.stats.broadcast.msgsPerSec)),
    broadcastMBps: stat(
      col((s) => s.stats.broadcast.bytesPerSec / 1e6),
      2,
    ),
    cpuPct: stat(col((s) => s.serverCpuPct)),
    systemCpuPct: stat(col((s) => s.systemCpuPct)),
    rssMb: { max: round(maxOf(col((s) => s.stats.memory.rssMb))) },
    eventLoopP99Ms: stat(
      col((s) => s.stats.eventLoop.p99Ms),
      2,
    ),
    queueDepthMax: maxOf(col((s) => s.stats.store.queueDepth)),
    slowConsumersMax: maxOf(col((s) => s.stats.broadcast.slowConsumers)),
    telemetryClientsMax: maxOf(col((s) => s.stats.clients.telemetry)),
    accepted: delta('accepted'),
    rateLimited: delta('rateLimited'),
    malformed: delta('malformed'),
    dropped: delta('dropped'),
  };
}
