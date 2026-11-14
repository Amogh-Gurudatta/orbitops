// Admin-editable detection rule; shape is the shared AlertRule contract.
import { model, Schema } from 'mongoose';
import { SEVERITIES, SUBSYSTEMS, RULE_KINDS } from '@orbitops/shared';
import type { AlertRule } from '@orbitops/shared';

const alertRuleSchema = new Schema<AlertRule>({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  subsystem: { type: String, enum: SUBSYSTEMS, required: true },
  severity: { type: String, enum: SEVERITIES, required: true },
  kind: { type: String, enum: RULE_KINDS, required: true },
  metric: { type: String, required: true },
  op: { type: String, enum: ['>', '<'], required: true },
  threshold: { type: Number, required: true },
  clearRatio: Number,
  samples: Number,
  windowSize: Number,
  enabled: { type: Boolean, required: true, default: true },
});

export const AlertRuleModel = model<AlertRule>('AlertRule', alertRuleSchema);
