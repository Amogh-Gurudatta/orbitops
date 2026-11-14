// Telemetry persistence: a bounded in-memory queue drained by batched insertMany calls.
//  - Downsampling: at most PERSIST_HZ samples per satellite per second reach the database.
//  - Backpressure: when the queue is full the OLDEST samples are shed (and counted); newest data wins.
//  - Concurrency: at most `concurrency` flushes are in flight (p-queue); stop() drains everything.
import PQueue from 'p-queue';
import type { SatGroup, TelemetryFrame } from '@orbitops/shared';

export interface TelemetryDoc extends TelemetryFrame {
  ts: Date;
  meta: { satId: number; group: SatGroup };
  seq: number;
  late?: true;
}

/** The subset of the native collection the writer needs (a fake in tests). */
export interface InsertTarget {
  insertMany(docs: TelemetryDoc[], options: { ordered: false }): Promise<unknown>;
}

export interface WriterOptions {
  persistHz: number;
  maxQueue?: number;
  flushIntervalMs?: number;
  batchSize?: number;
  concurrency?: number;
}

export interface WriterHooks {
  onFlush?(ms: number, docs: number): void;
  onDrop?(count: number): void;
  onError?(err: unknown, docs: number): void;
}

export interface Sample {
  satId: number;
  group: SatGroup;
  seq: number;
  ts: number;
  frame: TelemetryFrame;
  late: boolean;
}

interface PersistMark {
  seq: number;
  ts: number;
}

export class TelemetryWriter {
  private queue: TelemetryDoc[] = [];
  private head = 0;
  private readonly maxQueue: number;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly minGapMs: number;
  private readonly flushes: PQueue;
  private readonly lastPersisted = new Map<number, number>();
  /** Highest seq/ts already in the database at boot: re-sent older samples are skipped. */
  private readonly boot = new Map<number, PersistMark>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly target: InsertTarget,
    options: WriterOptions,
    private readonly hooks: WriterHooks = {},
  ) {
    this.maxQueue = options.maxQueue ?? 50_000;
    this.flushIntervalMs = options.flushIntervalMs ?? 500;
    this.batchSize = options.batchSize ?? 1000;
    this.minGapMs = 1000 / options.persistHz;
    this.flushes = new PQueue({ concurrency: options.concurrency ?? 2 });
  }

  get depth(): number {
    return this.queue.length - this.head;
  }

  /** Fraction of the queue in use, 0..1; the pipeline uses it to ask producers to slow down. */
  get fillRatio(): number {
    return this.depth / this.maxQueue;
  }

  /** Seeds the skip-already-persisted marks from the database (see loadBootMarks). */
  setBootMark(satId: number, seq: number, ts: number): void {
    this.boot.set(satId, { seq, ts });
    this.lastPersisted.set(satId, ts);
  }

  /**
   * Queues a sample unless downsampling or the boot marks exclude it. A late sample is only kept when its
   * time lies at least one persist interval beyond the last persisted point, so it fills a real hole.
   */
  offer(sample: Sample): boolean {
    const mark = this.boot.get(sample.satId);
    if (mark && sample.seq <= mark.seq && sample.ts <= mark.ts) return false;
    const last = this.lastPersisted.get(sample.satId);
    if (last !== undefined && sample.ts - last < this.minGapMs) return false;
    this.lastPersisted.set(sample.satId, sample.ts);

    if (this.depth >= this.maxQueue) {
      this.head++;
      this.hooks.onDrop?.(1);
      this.compact();
    }
    const doc: TelemetryDoc = {
      ts: new Date(sample.ts),
      meta: { satId: sample.satId, group: sample.group },
      seq: sample.seq,
      ...sample.frame,
    };
    if (sample.late) doc.late = true;
    this.queue.push(doc);
    if (this.depth >= this.batchSize) this.schedule();
    return true;
  }

  start(): void {
    this.timer ??= setInterval(() => this.schedule(), this.flushIntervalMs);
    this.timer.unref();
  }

  /** Stops the timer and writes out everything still queued. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.depth > 0) this.enqueueFlush();
    await this.flushes.onIdle();
  }

  /** Test hook / shutdown helper: resolves when nothing is in flight. */
  idle(): Promise<void> {
    return this.flushes.onIdle();
  }

  /** Releases consumed slots once they outweigh the live part of the array. */
  private compact(): void {
    if (this.head > 10_000 && this.head * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
  }

  /** Schedules batches without piling up unbounded tasks behind a slow database. */
  private schedule(): void {
    while (
      this.depth > 0 &&
      this.flushes.size + this.flushes.pending < this.flushes.concurrency * 2
    ) {
      this.enqueueFlush();
    }
  }

  private enqueueFlush(): void {
    const batch = this.queue.slice(this.head, this.head + this.batchSize);
    if (batch.length === 0) return;
    this.head += batch.length;
    this.compact();
    void this.flushes.add(async () => {
      const started = performance.now();
      try {
        await this.target.insertMany(batch, { ordered: false });
        this.hooks.onFlush?.(performance.now() - started, batch.length);
      } catch (err) {
        this.hooks.onError?.(err, batch.length);
      }
    });
  }
}
