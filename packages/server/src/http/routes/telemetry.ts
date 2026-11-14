// /telemetry: history as aligned columns for uPlot, plus the live snapshots of every satellite.
//
// Dedup contract between history and the live socket feed (clients draw history, then append live points):
//   - `lastSeq` is the highest `seq` among all persisted points inside the returned range (the maximum is
//     taken before downsampling, so it is exact), or -1 when the range holds no points.
//   - The client sets its live watermark to `lastSeq` and keeps only live events with `seq > lastSeq`.
//     Events at or below it are already covered by the history; events above it were not yet persisted (the
//     writer batches and downsamples), so keeping them leaves no gap at the seam.
//   - Sequence numbers are monotonic per satellite across producer restarts, so the comparison is safe.
//   - For rollup responses `lastSeq` is the highest seq of the rolled-up minutes; the newest minute(s) are not
//     rolled up yet, so the client appends live points that are newer than the last returned bucket.
import { Router } from 'express';
import { z } from 'zod';
import type { ServerContext } from '../../context.js';
import {
  downsampleColumns,
  isRollupMetric,
  RAW_MAX_RANGE_MS,
  RAW_METRICS,
  readRaw,
  readRollups,
  type Columns,
} from '../../store/history.js';
import { HttpError } from '../errors.js';
import { csv, intQuery, SatIdParam, TimeMs } from '../params.js';

const MAX_RANGE_MS = 31 * 24 * 3_600_000;
const DEFAULT_RANGE_MS = 3_600_000;
const MAX_METRICS = 12;

const TelemetryQuery = z.strictObject({
  satId: SatIdParam,
  from: TimeMs.optional(),
  to: TimeMs.optional(),
  metrics: csv.pipe(z.array(z.string().min(1).max(32)).min(1).max(MAX_METRICS)),
  maxPoints: intQuery(10, 5000, 1000),
  bands: z.enum(['0', '1']).default('0'),
});

export function createTelemetryRouter(ctx: ServerContext): Router {
  const router = Router();

  router.get('/latest', (_req, res) => {
    res.json({ snapshots: ctx.state.snapshots() });
  });

  router.get('/', async (req, res) => {
    const query = TelemetryQuery.parse(req.query);
    const serverTime = Date.now();
    const to = query.to ?? serverTime;
    const from = query.from ?? to - DEFAULT_RANGE_MS;
    if (from >= to) throw new HttpError(400, 'invalid_range');
    if (to - from > MAX_RANGE_MS) throw new HttpError(400, 'range_too_large');
    if (!ctx.catalog.has(query.satId)) throw new HttpError(404, 'satellite_not_found');

    const useRaw = to - from <= RAW_MAX_RANGE_MS;
    const supported = (metric: string) =>
      useRaw ? (RAW_METRICS as readonly string[]).includes(metric) : isRollupMetric(metric);
    const unsupported = query.metrics.filter((metric) => !supported(metric));
    if (unsupported.length > 0) {
      throw new HttpError(400, 'unsupported_metrics', {
        source: useRaw ? 'raw' : 'rollup',
        metrics: unsupported,
      });
    }

    const columns: Columns = useRaw
      ? await readRaw(query.satId, from, to, query.metrics)
      : await readRollups(query.satId, from, to, query.metrics, query.bands === '1');
    // Band series follow the shape chosen for their metric's average.
    const sampled = downsampleColumns(columns, query.metrics, query.maxPoints);
    res.json({
      satId: query.satId,
      source: useRaw ? 'raw' : 'rollup',
      t: sampled.t,
      series: sampled.series,
      lastSeq: sampled.lastSeq,
      serverTime,
    });
  });

  return router;
}
