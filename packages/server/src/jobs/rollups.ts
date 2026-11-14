// Minute rollups: raw telemetry (time-series, short TTL) is aggregated into `telemetry_1m` so long-range
// charts, heatmaps and summaries never scan raw points.
//
// Rollup document: { satId, bucket: Date (minute start), n, seqMax, eclipseFrac, <metric>: { avg, min, max } }.
// Every run re-aggregates the last few CLOSED minutes and overwrites them with $set (not $inc), so the job is
// idempotent: late samples and the writer's flush delay are absorbed, and a boot backfill can safely overlap.
import type { mongo } from 'mongoose';
import { nativeDb, TELEMETRY, TELEMETRY_1M } from '../db/index.js';
import type { Logger } from '../logger.js';

/** Metrics that get avg/min/max per minute. */
export const ROLLUP_METRICS = [
  'batSoc',
  'batV',
  'busA',
  'solarW',
  'panelTempC',
  'obcTempC',
  'rssiDbm',
  'snrDb',
  'attRateDps',
  'altKm',
] as const;
export type RollupMetric = (typeof ROLLUP_METRICS)[number];

/** `shadow` above this counts as eclipse (matches the anomaly engine's definition). */
export const ECLIPSE_SHADOW = 0.5;

export interface RollupStat {
  avg: number | null;
  min: number | null;
  max: number | null;
}

export type RollupDoc = {
  satId: number;
  bucket: Date;
  n: number;
  /** Highest sample seq in the minute; lets history responses report a dedup watermark. */
  seqMax: number;
  eclipseFrac: number;
} & Partial<Record<RollupMetric, RollupStat>>;

const MINUTE_MS = 60_000;
/** Closed minutes re-aggregated on every run, to absorb late samples. */
const RECHECK_MINUTES = 3;
const BACKFILL_CHUNK_MS = 3_600_000;
const DUPLICATE_KEY = 11000;

/** Aggregation turning raw samples in [from, to) into one rollup document per (satellite, minute). */
export function buildRollupPipeline(from: Date, to: Date): object[] {
  const group: Record<string, unknown> = {
    _id: { satId: '$meta.satId', bucket: { $dateTrunc: { date: '$ts', unit: 'minute' } } },
    n: { $sum: 1 },
    seqMax: { $max: '$seq' },
    eclipseFrac: { $avg: { $cond: [{ $gt: ['$shadow', ECLIPSE_SHADOW] }, 1, 0] } },
  };
  const project: Record<string, unknown> = {
    _id: 0,
    satId: '$_id.satId',
    bucket: '$_id.bucket',
    n: 1,
    seqMax: 1,
    eclipseFrac: 1,
  };
  for (const metric of ROLLUP_METRICS) {
    group[`${metric}_avg`] = { $avg: `$${metric}` };
    group[`${metric}_min`] = { $min: `$${metric}` };
    group[`${metric}_max`] = { $max: `$${metric}` };
    project[metric] = {
      avg: `$${metric}_avg`,
      min: `$${metric}_min`,
      max: `$${metric}_max`,
    };
  }
  return [{ $match: { ts: { $gte: from, $lt: to } } }, { $group: group }, { $project: project }];
}

/** The upserts that store aggregated documents, keyed by (satId, bucket). */
export function buildRollupWrites(docs: RollupDoc[]): mongo.AnyBulkWriteOperation<RollupDoc>[] {
  return docs.map((doc) => ({
    updateOne: {
      filter: { satId: doc.satId, bucket: doc.bucket },
      update: { $set: doc },
      upsert: true,
    },
  }));
}

/** The slices of the native collections the job needs (fakes in unit tests). */
export interface RollupSource {
  aggregate(pipeline: object[], options?: object): { toArray(): Promise<unknown[]> };
}
export interface RollupTarget {
  bulkWrite(
    ops: mongo.AnyBulkWriteOperation<RollupDoc>[],
    options: { ordered: false },
  ): Promise<unknown>;
  /** Newest bucket first. */
  newestBucket(): Promise<Date | undefined>;
}

const floorToMinute = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

export class RollupJob {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    private readonly source: RollupSource,
    private readonly target: RollupTarget,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Aggregates [from, to) (minute-aligned) and upserts the result. Returns the number of rollups written. */
  async aggregateRange(fromMs: number, toMs: number): Promise<number> {
    if (toMs <= fromMs) return 0;
    const docs = (await this.source
      .aggregate(buildRollupPipeline(new Date(fromMs), new Date(toMs)), {
        allowDiskUse: true,
        maxTimeMS: 120_000,
      })
      .toArray()) as RollupDoc[];
    if (docs.length === 0) return 0;
    try {
      await this.target.bulkWrite(buildRollupWrites(docs), { ordered: false });
    } catch (err) {
      // A concurrent instance may have inserted the same (satId, bucket); its value is equivalent.
      if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
    }
    return docs.length;
  }

  /** One scheduled run: re-aggregates the last few closed minutes. */
  runOnce(): Promise<number> {
    const closed = floorToMinute(this.now());
    return this.aggregateRange(closed - RECHECK_MINUTES * MINUTE_MS, closed);
  }

  /**
   * Boot backfill over the raw retention window, in hour-sized chunks. Resumes shortly before the newest
   * existing rollup, so a restart does not re-read hours of raw data.
   */
  async backfill(retentionHours: number): Promise<number> {
    const closed = floorToMinute(this.now());
    const windowStart = closed - retentionHours * 3_600_000;
    const newest = await this.target.newestBucket();
    const resumeFrom = newest
      ? Math.max(windowStart, newest.getTime() - RECHECK_MINUTES * MINUTE_MS)
      : windowStart;
    let written = 0;
    for (let from = floorToMinute(resumeFrom); from < closed; from += BACKFILL_CHUNK_MS) {
      written += await this.aggregateRange(from, Math.min(from + BACKFILL_CHUNK_MS, closed));
    }
    return written;
  }

  /** Backfills in the background, then runs every 60 s. Failures are logged and retried on the next tick. */
  start(retentionHours: number): void {
    this.running = this.backfill(retentionHours)
      .then((count) => this.log.info({ rollups: count }, 'rollup backfill complete'))
      .catch((err: unknown) => this.log.error({ err }, 'rollup backfill failed'));
    this.timer = setInterval(() => {
      this.running = this.running.then(() =>
        this.runOnce().then(
          () => undefined,
          (err: unknown) => this.log.error({ err }, 'rollup run failed'),
        ),
      );
    }, MINUTE_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}

/** The job wired to the real collections (requires an open Mongo connection). */
export function createRollupJob(log: Logger): RollupJob {
  const rollups = nativeDb().collection<RollupDoc>(TELEMETRY_1M);
  return new RollupJob(
    nativeDb().collection(TELEMETRY),
    {
      bulkWrite: (ops, options) => rollups.bulkWrite(ops, options),
      newestBucket: async () =>
        (
          await rollups
            .find({}, { projection: { bucket: 1, _id: 0 } })
            .sort({ bucket: -1 })
            .limit(1)
            .next()
        )?.bucket,
    },
    log,
  );
}
