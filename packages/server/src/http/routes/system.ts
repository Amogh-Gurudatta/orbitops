// /system: pipeline statistics and the ingest chaos switch (duplicates / reordering / malformed events).
import { Router } from 'express';
import { ChaosConfig } from '@orbitops/shared';
import { requireRole } from '../../auth/middleware.js';
import type { ServerContext } from '../../context.js';

export function createSystemRouter(ctx: ServerContext): Router {
  const router = Router();

  router.get('/stats', (_req, res) => {
    res.json(ctx.stats.snapshot());
  });

  router.get('/chaos', (_req, res) => {
    res.json({ chaos: ctx.gateway.currentChaos() });
  });

  router.put('/chaos', requireRole('admin'), (req, res) => {
    const chaos = ChaosConfig.parse(req.body);
    // The gateway keeps the config (for devices that connect later) and pushes it to connected ones.
    ctx.gateway.broadcastChaos(chaos);
    res.json({ chaos });
  });

  return router;
}
