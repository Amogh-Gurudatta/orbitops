// /alerts: filtered, cursor-paginated alert history, and operator acknowledge / resolve actions.
import { Router } from 'express';
import { trusted, type QueryFilter } from 'mongoose';
import { z } from 'zod';
import { AlertState, Severity } from '@orbitops/shared';
import { toAlert } from '../../alerts/manager.js';
import { requireRole } from '../../auth/middleware.js';
import type { AuthUser } from '../../auth/tokens.js';
import type { ServerContext } from '../../context.js';
import { AlertModel, type AlertDoc } from '../../models/index.js';
import { intQuery, SatIdParam, TimeMs } from '../params.js';

const AlertQuery = z.strictObject({
  state: AlertState.optional(),
  severity: Severity.optional(),
  satId: SatIdParam.optional(),
  limit: intQuery(1, 500, 100),
  /** Cursor: only alerts opened strictly before this time (ISO or epoch ms) - pass the last row's openedAt. */
  before: TimeMs.optional(),
});

const AlertParams = z.strictObject({ id: z.string().min(1).max(64) });

export function createAlertsRouter(ctx: ServerContext): Router {
  const router = Router();
  const operatorOrAdmin = requireRole('operator', 'admin');

  router.get('/', async (req, res) => {
    const query = AlertQuery.parse(req.query);
    const filter: QueryFilter<AlertDoc> = {};
    if (query.state) filter.state = query.state;
    if (query.severity) filter.severity = query.severity;
    if (query.satId !== undefined) filter.satId = query.satId;
    if (query.before !== undefined) filter.openedAt = trusted({ $lt: new Date(query.before) });
    const docs = await AlertModel.find(filter).sort({ openedAt: -1 }).limit(query.limit).lean();
    res.json({ alerts: docs.map((doc) => toAlert(doc)) });
  });

  router.post('/:id/ack', operatorOrAdmin, async (req, res) => {
    const { id } = AlertParams.parse(req.params);
    res.json({ alert: await ctx.alerts.ackAlert(id, req.user as AuthUser) });
  });

  router.post('/:id/resolve', operatorOrAdmin, async (req, res) => {
    const { id } = AlertParams.parse(req.params);
    res.json({ alert: await ctx.alerts.resolveAlert(id, req.user as AuthUser) });
  });

  return router;
}
