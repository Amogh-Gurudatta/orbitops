// Turns decoded wire frames into main-thread batches: merges deltas into full frames, applies
// dedup/watermark, and accumulates sample rows for satellites the UI is charting.
// Pure (no socket, no timers) so the worker stays a thin shell and this stays unit-testable.
import {
  decodeFrame,
  type TelemetryFrame,
  type TmDelta,
  type TmSnapshot,
  type CompactFullFrame,
} from '@orbitops/shared';
import { METRIC_COUNT, frameToRow } from './metrics.ts';
import { SeqTracker } from './seqTracker.ts';
import type { LatestUpdate, SampleChunk, TelemetryBatch } from './protocol.ts';

interface PendingSamples {
  t: number[];
  /** Row-major while accumulating: rows[i * METRIC_COUNT + c]. */
  rows: number[];
}

export class TelemetryAggregator {
  readonly tracker = new SeqTracker();
  private readonly frames = new Map<number, Partial<TelemetryFrame>>();
  private readonly pendingLatest = new Map<number, LatestUpdate>();
  private readonly pendingSamples = new Map<number, PendingSamples>();
  private sampled: ReadonlySet<number> = new Set();
  private readonly row = new Float64Array(METRIC_COUNT);

  /** @param onDeltaAccepted called with the sample timestamp (ms) of each accepted live delta (latency probe). */
  constructor(private readonly onDeltaAccepted?: (sampleTs: number) => void) {}

  /** Satellites with a sat:* subscription: only these produce sample chunks (ring buffers are lazy). */
  setSampledSats(satIds: ReadonlySet<number>): void {
    this.sampled = satIds;
  }

  setWatermark(satId: number, lastSeq: number): void {
    this.tracker.setWatermark(satId, lastSeq);
  }

  ingestSnapshots(snapshots: readonly TmSnapshot[]): void {
    for (const snap of snapshots) {
      const { isNewSample } = this.tracker.checkSnapshot(snap.s, snap.q);
      const frame = decodeFrame(snap.d as CompactFullFrame);
      this.frames.set(snap.s, { ...frame });
      this.record(snap.s, snap.q, snap.t, isNewSample);
    }
  }

  ingestDeltas(deltas: readonly TmDelta[]): void {
    for (const delta of deltas) {
      if (this.tracker.check(delta.s, delta.q) !== 'accept') continue;
      this.onDeltaAccepted?.(delta.t);
      const merged = Object.assign(this.frames.get(delta.s) ?? {}, decodeFrame(delta.d));
      this.frames.set(delta.s, merged);
      this.record(delta.s, delta.q, delta.t, true);
    }
  }

  /** Returns everything accumulated since the previous flush, or null if nothing changed. */
  flush(): TelemetryBatch | null {
    if (this.pendingLatest.size === 0) return null;
    const latest = [...this.pendingLatest.values()];
    const samples: SampleChunk[] = [];
    for (const [satId, pending] of this.pendingSamples) samples.push(toChunk(satId, pending));
    this.pendingLatest.clear();
    this.pendingSamples.clear();
    return { latest, samples };
  }

  private record(satId: number, seq: number, t: number, asSample: boolean): void {
    const frame = this.frames.get(satId)!;
    this.pendingLatest.set(satId, { satId, seq, t, frame: { ...frame } });
    if (!asSample || !this.sampled.has(satId)) return;
    frameToRow(frame, this.row);
    let pending = this.pendingSamples.get(satId);
    if (!pending) {
      pending = { t: [], rows: [] };
      this.pendingSamples.set(satId, pending);
    }
    pending.t.push(t / 1000);
    for (let c = 0; c < METRIC_COUNT; c++) pending.rows.push(this.row[c]!);
  }
}

function toChunk(satId: number, pending: PendingSamples): SampleChunk {
  const n = pending.t.length;
  const t = Float64Array.from(pending.t);
  const values = new Float64Array(n * METRIC_COUNT);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < METRIC_COUNT; c++) values[c * n + i] = pending.rows[i * METRIC_COUNT + c]!;
  }
  return { satId, n, t, values };
}
