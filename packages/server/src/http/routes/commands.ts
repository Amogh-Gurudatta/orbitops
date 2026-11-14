// /commands: operators command satellites. Every command is audited in Mongo, then relayed to the connected
// simulator devices over the ingest socket (the simulator owning the satellite acts on it).
import { Router } from 'express';
import { z } from 'zod';
import { Command } from '@orbitops/shared';
import { requireRole } from '../../auth/middleware.js';
import type { AuthUser } from '../../auth/tokens.js';
import type { ServerContext } from '../../context.js';
import { CommandModel, type CommandDoc } from '../../models/index.js';
import { HttpError } from '../errors.js';
import { intQuery, SatIdParam } from '../params.js';

const CommandQuery = z.strictObject({
  satId: SatIdParam.optional(),
  limit: intQuery(1, 100, 100),
});

const toWire = (doc: CommandDoc & { _id: { toString(): string } }) => ({
  id: doc._id.toString(),
  satId: doc.satId,
  kind: doc.kind,
  ...(doc.fault ? { fault: doc.fault } : {}),
  issuedBy: doc.issuedBy,
  issuedAt: doc.issuedAt.getTime(),
  status: doc.status,
});

export function createCommandsRouter(ctx: ServerContext): Router {
  const router = Router();

  router.post('/', requireRole('operator', 'admin'), async (req, res) => {
    const command = Command.parse(req.body);
    if (!ctx.catalog.has(command.satId)) throw new HttpError(404, 'satellite_not_found');
    const user = req.user as AuthUser;

    const delivered = ctx.gateway.connectedDevices() > 0;
    const doc = await CommandModel.create({
      ...command,
      issuedBy: user.email,
      issuedAt: new Date(),
      status: delivered ? 'sent' : 'no_device',
    });
    const record = toWire(doc.toObject());
    if (delivered) {
      ctx.gateway.sendCommandToDevices(command);
    }
    res.status(202).json({ command: record });
  });

  router.get('/', async (req, res) => {
    const { satId, limit } = CommandQuery.parse(req.query);
    const docs = await CommandModel.find(satId === undefined ? {} : { satId })
      .sort({ issuedAt: -1 })
      .limit(limit)
      .lean();
    res.json({ commands: docs.map((doc) => toWire(doc)) });
  });

  return router;
}
