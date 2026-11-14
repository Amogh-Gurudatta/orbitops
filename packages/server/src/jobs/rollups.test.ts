import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger.js';
import {
  buildRollupPipeline,
  buildRollupWrites,
  RollupJob,
  ROLLUP_METRICS,
  type RollupDoc,
  type RollupSource,
  type RollupTarget,
} from './rollups.js';

const MINUTE = 60_000;
const log = { info: vi.fn(), error: vi.fn() } as unknown as Logger;

type Stage = Record<string, Record<string, unknown>>;

describe('buildRollupPipeline', () => {
  const from = new Date('2026-11-15T10:00:00Z');
  const to = new Date('2026-11-15T10:03:00Z');
  const [match, group, project] = buildRollupPipeline(from, to) as [Stage, Stage, Stage];
  const grouped = group.$group as Record<string, unknown>;
  const projected = project.$project as Record<string, unknown>;

  it('matches the half-open time range', () => {
    expect(match.$match).toEqual({ ts: { $gte: from, $lt: to } });
  });

  it('groups by satellite and minute bucket', () => {
    expect(grouped._id).toEqual({
      satId: '$meta.satId',
      bucket: { $dateTrunc: { date: '$ts', unit: 'minute' } },
    });
    expect(grouped.n).toEqual({ $sum: 1 });
    expect(grouped.seqMax).toEqual({ $max: '$seq' });
  });

  it('computes avg/min/max for every rollup metric and the eclipse fraction', () => {
    for (const metric of ROLLUP_METRICS) {
      expect(grouped[`${metric}_avg`]).toEqual({ $avg: `$${metric}` });
      expect(grouped[`${metric}_min`]).toEqual({ $min: `$${metric}` });
      expect(grouped[`${metric}_max`]).toEqual({ $max: `$${metric}` });
      expect(projected[metric]).toEqual({
        avg: `$${metric}_avg`,
        min: `$${metric}_min`,
        max: `$${metric}_max`,
      });
    }
    expect(grouped.eclipseFrac).toEqual({ $avg: { $cond: [{ $gt: ['$shadow', 0.5] }, 1, 0] } });
    expect(projected).toMatchObject({ satId: '$_id.satId', bucket: '$_id.bucket' });
  });
});

describe('buildRollupWrites', () => {
  it('upserts one document per (satId, bucket) with $set', () => {
    const doc: RollupDoc = { satId: 1, bucket: new Date(0), n: 5, seqMax: 9, eclipseFrac: 0 };
    expect(buildRollupWrites([doc])).toEqual([
      {
        updateOne: {
          filter: { satId: 1, bucket: new Date(0) },
          update: { $set: doc },
          upsert: true,
        },
      },
    ]);
  });
});

describe('RollupJob', () => {
  const NOW = Date.UTC(2026, 10, 15, 12, 0, 30);
  const closed = Date.UTC(2026, 10, 15, 12, 0, 0);

  function setup(newest?: Date) {
    const ranges: { from: number; to: number }[] = [];
    const source: RollupSource = {
      aggregate(pipeline) {
        const { $match } = pipeline[0] as { $match: { ts: { $gte: Date; $lt: Date } } };
        ranges.push({ from: $match.ts.$gte.getTime(), to: $match.ts.$lt.getTime() });
        const doc: RollupDoc = {
          satId: 1,
          bucket: $match.ts.$gte,
          n: 1,
          seqMax: 1,
          eclipseFrac: 0,
        };
        return { toArray: async () => [doc] };
      },
    };
    const bulkWrite = vi.fn(async () => undefined);
    const target: RollupTarget = { bulkWrite, newestBucket: async () => newest };
    return { job: new RollupJob(source, target, log, () => NOW), ranges, bulkWrite };
  }

  it('re-aggregates the last closed minutes only', async () => {
    const { job, ranges, bulkWrite } = setup();
    await job.runOnce();
    expect(ranges).toEqual([{ from: closed - 3 * MINUTE, to: closed }]);
    expect(bulkWrite).toHaveBeenCalledWith(expect.any(Array), { ordered: false });
  });

  it('backfills the retention window in hour chunks when no rollups exist', async () => {
    const { job, ranges } = setup();
    await job.backfill(3);
    expect(ranges).toHaveLength(3);
    expect(ranges[0]!.from).toBe(closed - 3 * 3_600_000);
    expect(ranges.at(-1)!.to).toBe(closed);
  });

  it('resumes shortly before the newest rollup, so a restart does not rescan everything', async () => {
    const { job, ranges } = setup(new Date(closed - 10 * MINUTE));
    await job.backfill(6);
    expect(ranges).toEqual([{ from: closed - 13 * MINUTE, to: closed }]);
  });

  it('ignores duplicate-key errors from a concurrent instance but rethrows others', async () => {
    const { job, bulkWrite } = setup();
    bulkWrite.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    await expect(job.runOnce()).resolves.toBe(1);
    bulkWrite.mockRejectedValueOnce(new Error('boom'));
    await expect(job.runOnce()).rejects.toThrow('boom');
  });
});
