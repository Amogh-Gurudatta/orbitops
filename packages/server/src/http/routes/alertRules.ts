// /alert-rules: list the detection rules; admins tune them, and changes hot-reload into the running engine.
import { Router } from 'express';
import { z } from 'zod';
import { AlertRule } from '@orbitops/shared';
import { loadRules } from '../../alerts/rules.js';
import { requireRole } from '../../auth/middleware.js';
import type { ServerContext } from '../../context.js';
import { AlertRuleModel } from '../../models/index.js';
import { HttpError } from '../errors.js';

/** Only tuning knobs are editable; identity, metric and detector kind are fixed. */
const RulePatch = AlertRule.pick({
  threshold: true,
  severity: true,
  enabled: true,
  samples: true,
  clearRatio: true,
  windowSize: true,
})
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { error: 'at least one field is required' });

const RuleParams = z.strictObject({ id: z.string().min(1).max(100) });

export function createAlertRulesRouter(ctx: ServerContext): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const rules = await AlertRuleModel.find({}, { _id: 0, __v: 0 }).sort({ id: 1 }).lean();
    res.json({ rules });
  });

  router.put('/:id', requireRole('admin'), async (req, res) => {
    const { id } = RuleParams.parse(req.params);
    const patch = RulePatch.parse(req.body);
    const rule = await AlertRuleModel.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after', lean: true, projection: { _id: 0, __v: 0 } },
    );
    if (!rule) throw new HttpError(404, 'rule_not_found');
    ctx.anomaly.setRules(await loadRules(ctx.log));
    res.json({ rule });
  });

  return router;
}
