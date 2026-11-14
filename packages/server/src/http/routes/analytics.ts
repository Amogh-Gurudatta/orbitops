// /analytics: fleet heatmap and per-satellite summary, both served from the minute rollups.
import { Router } from 'express';
import { trusted } from 'mongoose';
import { z } from 'zod';
import { SAT_GROUPS } from '@orbitops/shared';
import type { ServerContext } from '../../context.js';
import { nativeDb, TELEMETRY_1M } from '../../db/index.js';
import { ROLLUP_METRICS, type RollupMetric } from '../../jobs/rollups.js';
import { AlertModel } from '../../models/index.js';
import { HttpError } from '../errors.js';
import { intQuery, SatIdParam, TimeMs } from '../params.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3_600_000;
const MAX_RANGE_MS = 7 * DAY_MS;
const MAX_HEATMAP_BUCKETS = 2_000;
/** Baseline series are thinned to roughly this many points. */
const BASELINE_TARGET_POINTS = 500;

const Metric = z.enum(ROLLUP_METRICS);

const HeatmapQuery = z.strictObject({
  metric: Metric.default('panelTempC'),
  from: TimeMs.optional(),
  to: TimeMs.optional(),
  /** Bucket width in minutes. */
  bucketMin: intQuery(1, 1440, 10),
});

const SummaryQuery = z.strictObject({
  satId: SatIdParam,
  from: TimeMs.optional(),
  to: TimeMs.optional(),
});

const round = (value: number | null | undefined, digits = 3): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 10 ** digits) / 10 ** digits
    : null;

function resolveRange(from: number | undefined, to: number | undefined, defaultMs: number) {
  const end = to ?? Date.now();
  const start = from ?? end - defaultMs;
  if (start >= end) throw new HttpError(400, 'invalid_range');
  if (end - start > MAX_RANGE_MS) throw new HttpError(400, 'range_too_large');
  return { start, end };
}

/** Index of the fixed-width bin a rollup bucket falls into, counted from `gridStart` (epoch-aligned). */
const binIndex = (gridStart: number, binMs: number) => ({
  $floor: { $divide: [{ $subtract: ['$bucket', new Date(gridStart)] }, binMs] },
});

export function createAnalyticsRouter(ctx: ServerContext): Router {
  const router = Router();
  const rollups = () => nativeDb().collection(TELEMETRY_1M);

  router.get('/heatmap', async (req, res) => {
    const query = HeatmapQuery.parse(req.query);
    const { start, end } = resolveRange(query.from, query.to, 3_600_000);
    const binMs = query.bucketMin * MINUTE_MS;
    const gridStart = Math.floor(start / binMs) * binMs;
    const columns = Math.ceil((end - gridStart) / binMs);
    if (columns > MAX_HEATMAP_BUCKETS) throw new HttpError(400, 'too_many_buckets');

    const rows = await rollups()
      .aggregate<{ _id: { satId: number; bin: number }; value: number | null }>(
        [
          { $match: { bucket: { $gte: new Date(gridStart), $lt: new Date(end) } } },
          {
            $group: {
              _id: { satId: '$satId', bin: binIndex(gridStart, binMs) },
              value: { $avg: `$${query.metric}.avg` },
            },
          },
        ],
        { maxTimeMS: 30_000 },
      )
      .toArray();

    // Rows: every catalogue satellite, ordered by group (taxonomy order) then id.
    const groupRank = (group: string) => SAT_GROUPS.indexOf(group as (typeof SAT_GROUPS)[number]);
    const satIds = ctx.catalog
      .all()
      .sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.satId - b.satId)
      .map((entry) => entry.satId);
    const rowOf = new Map(satIds.map((satId, i) => [satId, i]));
    const values: (number | null)[][] = satIds.map(() =>
      new Array<number | null>(columns).fill(null),
    );
    for (const { _id, value } of rows) {
      const row = rowOf.get(_id.satId);
      if (row !== undefined && _id.bin >= 0 && _id.bin < columns)
        values[row]![_id.bin] = round(value);
    }
    const buckets = Array.from({ length: columns }, (_, i) => gridStart + i * binMs);
    res.json({ satIds, buckets, values });
  });

  router.get('/summary', async (req, res) => {
    const query = SummaryQuery.parse(req.query);
    if (!ctx.catalog.has(query.satId)) throw new HttpError(404, 'satellite_not_found');
    const { start, end } = resolveRange(query.from, query.to, DAY_MS);
    const [statsRows, baseline, alertCount] = await Promise.all([
      summaryStats(query.satId, start, end),
      baselineBands(query.satId, start, end),
      AlertModel.countDocuments({
        satId: query.satId,
        openedAt: trusted({ $gte: new Date(start), $lt: new Date(end) }),
      }),
    ]);
    res.json({
      metrics: statsRows.metrics,
      eclipseFrac: statsRows.eclipseFrac,
      alertCount,
      baseline,
    });
  });

  async function summaryStats(satId: number, start: number, end: number) {
    const group: Record<string, unknown> = {
      _id: null,
      eclipseFrac: { $avg: '$eclipseFrac' },
    };
    for (const metric of ROLLUP_METRICS) {
      group[`${metric}_min`] = { $min: `$${metric}.min` };
      group[`${metric}_max`] = { $max: `$${metric}.max` };
      group[`${metric}_avg`] = { $avg: `$${metric}.avg` };
    }
    const [row] = await rollups()
      .aggregate<Record<string, number | null>>(
        [
          { $match: { satId, bucket: { $gte: new Date(start), $lt: new Date(end) } } },
          { $group: group },
        ],
        { maxTimeMS: 15_000 },
      )
      .toArray();
    const metrics = Object.fromEntries(
      ROLLUP_METRICS.map((metric) => [
        metric,
        {
          min: round(row?.[`${metric}_min`]),
          max: round(row?.[`${metric}_max`]),
          avg: round(row?.[`${metric}_avg`]),
        },
      ]),
    ) as Record<RollupMetric, { min: number | null; max: number | null; avg: number | null }>;
    return { metrics, eclipseFrac: round(row?.eclipseFrac) };
  }

  /** The same-length window one day earlier, shifted forward by 24 h so it overlays the requested range. */
  async function baselineBands(satId: number, start: number, end: number) {
    const baseStart = start - DAY_MS;
    const baseEnd = end - DAY_MS;
    const binMs =
      Math.max(1, Math.ceil((end - start) / MINUTE_MS / BASELINE_TARGET_POINTS)) * MINUTE_MS;
    const gridStart = Math.floor(baseStart / binMs) * binMs;
    const group: Record<string, unknown> = { _id: binIndex(gridStart, binMs) };
    for (const metric of ROLLUP_METRICS) {
      group[`${metric}_avg`] = { $avg: `$${metric}.avg` };
      group[`${metric}_min`] = { $min: `$${metric}.min` };
      group[`${metric}_max`] = { $max: `$${metric}.max` };
    }
    const rows = await rollups()
      .aggregate<Record<string, number>>(
        [
          { $match: { satId, bucket: { $gte: new Date(gridStart), $lt: new Date(baseEnd) } } },
          { $group: group },
          { $sort: { _id: 1 } },
        ],
        { maxTimeMS: 15_000 },
      )
      .toArray();
    const t = rows.map((row) => gridStart + (row._id as number) * binMs + DAY_MS);
    return Object.fromEntries(
      ROLLUP_METRICS.map((metric) => [
        metric,
        {
          t,
          avg: rows.map((row) => round(row[`${metric}_avg`])),
          min: rows.map((row) => round(row[`${metric}_min`])),
          max: rows.map((row) => round(row[`${metric}_max`])),
        },
      ]),
    );
  }

  return router;
}
