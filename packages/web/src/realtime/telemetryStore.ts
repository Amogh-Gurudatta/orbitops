// Non-React store for high-rate telemetry. Per satellite it keeps the latest frame, a live ring
// buffer (columns aligned to NUMERIC_METRICS) and an optional history tier fetched over REST.
// React never subscribes to this directly: panels poll `version` from the shared frame loop.
import type { TelemetryFrame } from '@orbitops/shared';
import { LIVE_BUFFER_SAMPLES } from '../config.ts';
import type { TelemetryHistory } from '../api/types.ts';
import { RingBuffer } from './ringBuffer.ts';
import { METRIC_COUNT, metricColumn, type NumericMetric } from './metrics.ts';
import type { LatestUpdate, TelemetryBatch } from './protocol.ts';

interface HistoryTier {
  /** Epoch seconds, ascending. */
  t: Float64Array;
  columns: Map<string, Float64Array>;
  lastSeq: number;
}

interface SatEntry {
  latest: Partial<TelemetryFrame>;
  seq: number;
  /** Sample time of the latest frame, epoch ms. */
  sampleTs: number;
  /** Local wall-clock ms when the latest frame arrived (freshness / STALE). */
  seenAt: number;
  ring: RingBuffer | null;
  history: HistoryTier | null;
  /** Bumped when the ring or history tier changes. */
  version: number;
}

/** What StripChart.setData consumes: x in epoch seconds, one Float64Array per requested metric. */
export interface ChartData {
  t: Float64Array;
  series: Float64Array[];
}

export type BatchListener = (updates: readonly LatestUpdate[]) => void;
export type WatermarkSink = (satId: number, lastSeq: number) => void;

class TelemetryStore {
  private readonly sats = new Map<number, SatEntry>();
  private readonly listeners = new Set<BatchListener>();
  private watermarkSink: WatermarkSink | null = null;
  /** Bumped whenever any satellite's latest frame changes (fleet table / globe dirty flag). */
  fleetVersion = 0;

  /** Applies one worker batch: merges latest frames, appends sample chunks to ring buffers. */
  applyBatch(batch: TelemetryBatch): void {
    const now = Date.now();
    for (const u of batch.latest) {
      const entry = this.entry(u.satId);
      entry.latest = { ...entry.latest, ...u.frame };
      entry.seq = u.seq;
      entry.sampleTs = u.t;
      entry.seenAt = now;
    }
    for (const chunk of batch.samples) {
      const entry = this.entry(chunk.satId);
      entry.ring ??= new RingBuffer(LIVE_BUFFER_SAMPLES, METRIC_COUNT);
      entry.ring.pushMany(chunk.t, chunk.values, chunk.n);
      entry.version++;
    }
    this.fleetVersion++;
    for (const listener of this.listeners) listener(batch.latest);
  }

  /** Seeds the latest frame from REST (e.g. GET /telemetry/latest) before the socket delivers. */
  seedLatest(satId: number, seq: number, sampleTs: number, frame: Partial<TelemetryFrame>): void {
    const entry = this.entry(satId);
    if (seq < entry.seq) return;
    entry.latest = { ...entry.latest, ...frame };
    entry.seq = seq;
    entry.sampleTs = sampleTs;
    entry.seenAt = Date.now();
    this.fleetVersion++;
  }

  latest(satId: number): Readonly<Partial<TelemetryFrame>> | undefined {
    return this.sats.get(satId)?.latest;
  }

  /** Wall-clock ms of the last frame for this satellite (undefined if none yet). */
  lastSeenAt(satId: number): number | undefined {
    return this.sats.get(satId)?.seenAt;
  }

  /** Sample time (epoch ms) of the latest frame. */
  latestSampleTs(satId: number): number | undefined {
    return this.sats.get(satId)?.sampleTs;
  }

  /** Per-satellite dirty counter: changes whenever chart data for the satellite changes. */
  version(satId: number): number {
    return this.sats.get(satId)?.version ?? 0;
  }

  satIds(): number[] {
    return [...this.sats.keys()];
  }

  /** Push-style access for consumers that want every batch (the globe). */
  onBatch(listener: BatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The realtime client wires this to worker.setHistoryWatermark. */
  setWatermarkSink(sink: WatermarkSink | null): void {
    this.watermarkSink = sink;
  }

  /**
   * Installs a REST history response as the tier *behind* live data, and tells the worker to drop
   * live events the response already covers (seq <= lastSeq). Overlap with samples already in the
   * ring is resolved at read time in favour of live data.
   */
  mergeHistory(satId: number, history: TelemetryHistory): void {
    const entry = this.entry(satId);
    const n = history.t.length;
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = history.t[i]! / 1000;
    const columns = new Map<string, Float64Array>();
    for (const [metric, values] of Object.entries(history.series)) {
      const col = new Float64Array(n);
      for (let i = 0; i < n; i++) col[i] = values[i] ?? NaN;
      columns.set(metric, col);
    }
    entry.history = { t, columns, lastSeq: history.lastSeq };
    entry.version++;
    this.watermarkSink?.(satId, history.lastSeq);
  }

  clearHistory(satId: number): void {
    const entry = this.sats.get(satId);
    if (!entry?.history) return;
    entry.history = null;
    entry.version++;
  }

  /** Drops everything (logout). */
  reset(): void {
    this.sats.clear();
    this.fleetVersion++;
  }

  /**
   * Creates a reader that assembles history + live data for fixed metrics into reusable arrays.
   * Each chart owns one reader, so scratch buffers are never shared between charts.
   */
  reader(satId: number, metrics: readonly NumericMetric[]): WindowReader {
    return new WindowReader(this, satId, metrics);
  }

  /** @internal used by WindowReader */
  snapshotFor(satId: number): {
    ring: RingBuffer | null;
    history: HistoryTier | null;
    version: number;
  } {
    const entry = this.sats.get(satId);
    return {
      ring: entry?.ring ?? null,
      history: entry?.history ?? null,
      version: entry?.version ?? 0,
    };
  }

  private entry(satId: number): SatEntry {
    let entry = this.sats.get(satId);
    if (!entry) {
      entry = {
        latest: {},
        seq: -1,
        sampleTs: 0,
        seenAt: 0,
        ring: null,
        history: null,
        version: 0,
      };
      this.sats.set(satId, entry);
    }
    return entry;
  }
}

/** First index in sorted `t[from..to)` whose value is >= x. */
function lowerBound(t: Float64Array, x: number, from: number, to: number): number {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class WindowReader {
  private scratchT = new Float64Array(0);
  private scratchSeries: Float64Array[];
  private lastVersion = -1;
  private lastWindow: number | undefined = undefined;
  private readonly columns: number[];

  constructor(
    private readonly store: TelemetryStore,
    private readonly satId: number,
    private readonly metrics: readonly NumericMetric[],
  ) {
    this.columns = metrics.map(metricColumn);
    this.scratchSeries = metrics.map(() => new Float64Array(0));
  }

  /**
   * Returns the assembled window (oldest to newest), or null when nothing changed since the last
   * call. `windowS` trims to the most recent N seconds. `force` ignores the dirty check.
   */
  read(windowS?: number, force = false): ChartData | null {
    const { ring, history, version } = this.store.snapshotFor(this.satId);
    if (!force && version === this.lastVersion && windowS === this.lastWindow) return null;
    this.lastVersion = version;
    this.lastWindow = windowS;

    const live = ring?.toArrays();
    const liveLen = live?.length ?? 0;
    const liveFirst = liveLen > 0 ? live!.t[0]! : Infinity;

    // History only covers time before the first live sample; live wins in any overlap.
    const histEnd = history ? lowerBound(history.t, liveFirst, 0, history.t.length) : 0;
    const newest = liveLen > 0 ? live!.t[liveLen - 1]! : histEnd > 0 ? history!.t[histEnd - 1]! : 0;
    const cutoff = windowS === undefined ? -Infinity : newest - windowS;
    const histStart = history ? lowerBound(history.t, cutoff, 0, histEnd) : 0;
    const liveStart = live ? lowerBound(live.t, cutoff, 0, liveLen) : 0;

    const histCount = histEnd - histStart;
    const liveCount = liveLen - liveStart;
    const total = histCount + liveCount;
    this.ensureCapacity(total);

    if (history && histCount > 0) this.scratchT.set(history.t.subarray(histStart, histEnd), 0);
    if (live && liveCount > 0) this.scratchT.set(live.t.subarray(liveStart), histCount);

    for (let m = 0; m < this.metrics.length; m++) {
      const out = this.scratchSeries[m]!;
      const histCol = history?.columns.get(this.metrics[m]!);
      if (histCount > 0) {
        if (histCol) out.set(histCol.subarray(histStart, histEnd), 0);
        else out.fill(NaN, 0, histCount);
      }
      if (live && liveCount > 0)
        out.set(live.columns[this.columns[m]!]!.subarray(liveStart), histCount);
    }

    return {
      t: this.scratchT.subarray(0, total),
      series: this.scratchSeries.map((s) => s.subarray(0, total)),
    };
  }

  private ensureCapacity(n: number): void {
    if (this.scratchT.length >= n) return;
    const size = Math.max(n, Math.ceil(this.scratchT.length * 1.5), 256);
    this.scratchT = new Float64Array(size);
    this.scratchSeries = this.metrics.map(() => new Float64Array(size));
  }
}

export const telemetryStore = new TelemetryStore();
export type { TelemetryStore };
