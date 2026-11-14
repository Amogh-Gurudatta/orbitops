// /satellites: the fleet catalogue with a live health status, and one satellite with its latest snapshot.
import { Router } from 'express';
import { z } from 'zod';
import type { TmSnapshot } from '@orbitops/shared';
import type { ServerContext } from '../../context.js';
import { AlertModel, Satellite, type SatelliteDoc } from '../../models/index.js';
import { HttpError } from '../errors.js';
import { SatIdParam } from '../params.js';

export type SatelliteStatus = 'NOMINAL' | 'CAUTION' | 'WARNING' | 'STALE';

/** No sample for this long (server clock) marks a satellite STALE. */
export const STALE_AFTER_MS = 15_000;

const SatelliteParams = z.strictObject({ satId: SatIdParam });

const toWire = (doc: SatelliteDoc, status: SatelliteStatus) => ({
  satId: doc.satId,
  name: doc.name,
  group: doc.group,
  line1: doc.line1,
  line2: doc.line2,
  epoch: doc.epoch.getTime(),
  status,
});

/** Worst severity among unresolved alerts per satellite (or one satellite), in one query. */
async function worstOpenSeverity(satId?: number): Promise<Map<number, 'WARNING' | 'CAUTION'>> {
  const rows = await AlertModel.aggregate<{ _id: number; warnings: number; cautions: number }>([
    { $match: { state: { $in: ['open', 'acked'] }, ...(satId === undefined ? {} : { satId }) } },
    {
      $group: {
        _id: '$satId',
        warnings: { $sum: { $cond: [{ $eq: ['$severity', 'WARNING'] }, 1, 0] } },
        cautions: { $sum: { $cond: [{ $eq: ['$severity', 'CAUTION'] }, 1, 0] } },
      },
    },
  ]);
  const worst = new Map<number, 'WARNING' | 'CAUTION'>();
  for (const row of rows) {
    if (row.warnings > 0) worst.set(row._id, 'WARNING');
    else if (row.cautions > 0) worst.set(row._id, 'CAUTION');
  }
  return worst;
}

export function createSatellitesRouter(ctx: ServerContext): Router {
  const router = Router();

  function statusOf(satId: number, worst: Map<number, 'WARNING' | 'CAUTION'>): SatelliteStatus {
    const seenAt = ctx.state.lastSeenAt(satId);
    if (seenAt === undefined || Date.now() - seenAt > STALE_AFTER_MS) return 'STALE';
    return worst.get(satId) ?? 'NOMINAL';
  }

  router.get('/', async (_req, res) => {
    const [docs, worst] = await Promise.all([
      Satellite.find({}, { _id: 0 }).sort({ satId: 1 }).lean(),
      worstOpenSeverity(),
    ]);
    res.json({ satellites: docs.map((doc) => toWire(doc, statusOf(doc.satId, worst))) });
  });

  router.get('/:satId', async (req, res) => {
    const { satId } = SatelliteParams.parse(req.params);
    const [doc, worst] = await Promise.all([
      Satellite.findOne({ satId }, { _id: 0 }).lean(),
      worstOpenSeverity(satId),
    ]);
    if (!doc) throw new HttpError(404, 'satellite_not_found');
    const latest: TmSnapshot | null = ctx.state.snapshot(satId) ?? null;
    res.json({ satellite: toWire(doc, statusOf(satId, worst)), latest });
  });

  return router;
}
