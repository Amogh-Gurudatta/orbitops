// Message shapes shared by the socket worker and the main thread.
import type { Alert, TelemetryFrame } from '@orbitops/shared';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unauthorized';

/** Latest merged frame for one satellite; only satellites that changed in the batch window appear. */
export interface LatestUpdate {
  satId: number;
  seq: number;
  /** Sample time, epoch ms. */
  t: number;
  frame: Partial<TelemetryFrame>;
}

/**
 * Appended samples for one satellite, as transferable typed arrays.
 * `t` is epoch SECONDS (uPlot's native unit). `values` is column-major:
 * values[c * n + i] is metric NUMERIC_METRICS[c] at sample i. NaN marks null/unknown.
 */
export interface SampleChunk {
  satId: number;
  n: number;
  t: Float64Array;
  values: Float64Array;
}

export interface TelemetryBatch {
  latest: LatestUpdate[];
  samples: SampleChunk[];
}

export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  n: number;
  /** Estimated server clock minus client clock, ms. */
  offsetMs: number;
}

export interface DedupStats {
  accepted: number;
  duplicates: number;
  belowWatermark: number;
  restarts: number;
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

export interface WorkerStats extends DedupStats {
  batchesPosted: number;
  rooms: string[];
}

/** Callbacks the main thread hands to the worker (wrapped with Comlink.proxy). */
export interface WorkerEvents {
  onBatch(batch: TelemetryBatch): void;
  onConnection(state: ConnectionState): void;
  onAlert(alert: Alert, isNew: boolean): void;
  onServerStats(stats: PipelineStats): void;
  onLatency(stats: LatencyStats): void;
}

/** Worker API exposed through Comlink. */
export interface SocketWorkerApi {
  connect(events: WorkerEvents): Promise<void>;
  disconnect(): Promise<void>;
  /** Forces a new handshake (used after a token refresh). */
  reconnect(): Promise<void>;
  subscribe(rooms: string[], hz: number): Promise<void>;
  unsubscribe(rooms: string[]): Promise<void>;
  /** Live events for this satellite with seq <= lastSeq are dropped (history/live dedup). */
  setHistoryWatermark(satId: number, lastSeq: number): Promise<void>;
  getStats(): Promise<WorkerStats>;
}
