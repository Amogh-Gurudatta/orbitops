// The staged ingest pipeline: validate -> rate limit -> dedup -> reorder -> state + anomaly -> persistence.
// All collaborators are injected, so it runs (and is tested) without sockets or a database.
import { DEDUP_WINDOW, type IngestAck, type SatGroup, type TelemetryEvent } from '@orbitops/shared';
import type { AlertTransition, AnomalyEngine } from '../anomaly/index.js';
import { mayPublish, type DeviceIdentity } from '../auth/deviceKey.js';
import type { CounterSink } from '../metrics/collector.js';
import type { StateStore } from '../state/store.js';
import type { Sample } from '../store/writer.js';
import { SeqDeduplicator } from './dedup.js';
import type { DeviceRateLimiter } from './rateLimit.js';
import { ReorderBuffer, type ReorderResult } from './reorder.js';
import { validateBatch } from './validate.js';

export interface PipelineDeps {
  now(): number;
  limiter: DeviceRateLimiter;
  state: Pick<StateStore, 'apply'>;
  anomaly: Pick<AnomalyEngine, 'evaluate'>;
  /** Group of a satellite, or undefined when the source is not in the catalogue. */
  groupOf(satId: number): SatGroup | undefined;
  persist(sample: Sample): void;
  onTransitions(transitions: AlertTransition[]): void;
  counters: CounterSink;
  /** 0..1 fill of the persistence queue; above PRESSURE_RATIO the ack asks the producer to slow down. */
  writerFill?(): number;
}

const PRESSURE_RATIO = 0.8;
const PRESSURE_RETRY_MS = 250;

interface SourceState {
  satId: number;
  group: SatGroup;
  dedup: SeqDeduplicator;
  reorder: ReorderBuffer;
  /** Timestamp of the newest event seen, used to tell a restarted source from a stale replay. */
  newestTs: number;
}

const rejectedAck = (rejected: number, retryAfterMs?: number): IngestAck => ({
  ok: false,
  accepted: 0,
  duplicates: 0,
  rejected,
  ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
});

export class IngestPipeline {
  private readonly sources = new Map<string, SourceState>();

  constructor(private readonly deps: PipelineDeps) {}

  async ingest(device: DeviceIdentity, raw: unknown): Promise<IngestAck> {
    const { counters } = this.deps;
    const now = this.deps.now();

    const validated = validateBatch(raw, now);
    if (!validated.ok) {
      counters.inc('malformed');
      return rejectedAck(1);
    }
    const { batch } = validated;
    const group = this.deps.groupOf(batch.satId);
    if (!mayPublish(device, batch.sourceId) || group === undefined) {
      counters.inc('malformed', batch.total);
      return rejectedAck(batch.total);
    }

    const retryAfterMs = await this.deps.limiter.consume(device.id, batch.total);
    if (retryAfterMs > 0) {
      counters.inc('rateLimited', batch.total);
      return rejectedAck(0, retryAfterMs);
    }

    counters.inc('malformed', batch.malformed);
    const source = this.sourceFor(batch.sourceId, batch.satId, group);
    let accepted = 0;
    let duplicates = 0;
    for (const event of batch.events) {
      this.noteSourceRestart(source, event);
      if (source.dedup.classify(event.seq) === 'duplicate') {
        duplicates++;
        continue;
      }
      accepted++;
      source.newestTs = Math.max(source.newestTs, event.ts);
      this.handleReorder(source, source.reorder.push(event, now), now);
    }
    counters.inc('duplicates', duplicates);
    counters.inc('accepted', accepted);

    const ack: IngestAck = { ok: true, accepted, duplicates, rejected: batch.malformed };
    if ((this.deps.writerFill?.() ?? 0) > PRESSURE_RATIO) ack.retryAfterMs = PRESSURE_RETRY_MS;
    return ack;
  }

  /** Releases events whose reorder hold expired. Call every ~50 ms. */
  tick(): void {
    const now = this.deps.now();
    for (const source of this.sources.values())
      this.handleReorder(source, source.reorder.flush(now), now);
  }

  private sourceFor(sourceId: string, satId: number, group: SatGroup): SourceState {
    let source = this.sources.get(sourceId);
    if (!source) {
      source = {
        satId,
        group,
        dedup: new SeqDeduplicator(),
        reorder: new ReorderBuffer(),
        newestTs: 0,
      };
      this.sources.set(sourceId, source);
    }
    return source;
  }

  /** A seq far below the high-watermark on a newer timestamp means the producer restarted its counter. */
  private noteSourceRestart(source: SourceState, event: TelemetryEvent): void {
    if (event.seq + DEDUP_WINDOW < source.dedup.highWatermark && event.ts > source.newestTs) {
      source.dedup = new SeqDeduplicator();
      source.reorder = new ReorderBuffer();
    }
  }

  private handleReorder(source: SourceState, result: ReorderResult, now: number): void {
    const { counters } = this.deps;
    if (result.reordered) counters.inc('outOfOrder', result.reordered);
    if (result.gaps) counters.inc('gapsSkipped', result.gaps);
    if (result.late.length) counters.inc('late', result.late.length);
    for (const event of result.released) this.applyLive(source, event, now);
    for (const event of result.late) this.persist(source, event, true);
  }

  private applyLive(source: SourceState, event: TelemetryEvent, now: number): void {
    this.deps.state.apply(source.satId, event.seq, event.ts, event.data, now);
    const transitions = this.deps.anomaly.evaluate(source.satId, event.data, event.ts);
    if (transitions.length > 0) this.deps.onTransitions(transitions);
    this.persist(source, event, false);
  }

  private persist(source: SourceState, event: TelemetryEvent, late: boolean): void {
    this.deps.persist({
      satId: source.satId,
      group: source.group,
      seq: event.seq,
      ts: event.ts,
      frame: event.data,
      late,
    });
  }
}
