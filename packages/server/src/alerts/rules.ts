// Alert rules live in Mongo so admins can edit them; the default set is inserted on first boot.
import { AlertRule } from '@orbitops/shared';
import { DEFAULT_RULES } from '../anomaly/index.js';
import type { Logger } from '../logger.js';
import { AlertRuleModel } from '../models/alertRule.js';

export async function loadRules(log: Logger): Promise<AlertRule[]> {
  if ((await AlertRuleModel.estimatedDocumentCount()) === 0) {
    await AlertRuleModel.insertMany(DEFAULT_RULES);
    log.info({ count: DEFAULT_RULES.length }, 'inserted default alert rules');
  }
  const docs = await AlertRuleModel.find({}, { _id: 0, __v: 0 }).lean();
  const rules: AlertRule[] = [];
  for (const doc of docs) {
    const parsed = AlertRule.safeParse(doc);
    if (parsed.success) rules.push(parsed.data);
    else log.warn({ rule: doc.id }, 'skipping invalid alert rule');
  }
  return rules;
}
