// Alert lifecycle document (open -> acked -> resolved). Mirrors the shared Alert contract; times are Dates here.
import { model, Schema } from 'mongoose';
import { ALERT_STATES, SEVERITIES, SUBSYSTEMS } from '@orbitops/shared';
import type { AlertState, Severity, Subsystem } from '@orbitops/shared';

export interface AlertDoc {
  key: string;
  satId: number;
  ruleId: string;
  subsystem: Subsystem;
  severity: Severity;
  state: AlertState;
  message: string;
  value: number | null;
  threshold: number | null;
  openedAt: Date;
  lastSeenAt: Date;
  count: number;
  ackedBy?: string;
  ackedAt?: Date;
  resolvedAt?: Date;
  /** Server instance that last wrote this alert; lets change-stream listeners skip their own writes. */
  instanceId?: string;
}

const alertSchema = new Schema<AlertDoc>({
  key: { type: String, required: true },
  satId: { type: Number, required: true },
  ruleId: { type: String, required: true },
  subsystem: { type: String, enum: SUBSYSTEMS, required: true },
  severity: { type: String, enum: SEVERITIES, required: true },
  state: { type: String, enum: ALERT_STATES, required: true, default: 'open' },
  message: { type: String, required: true },
  value: { type: Number, default: null },
  threshold: { type: Number, default: null },
  openedAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  count: { type: Number, required: true, default: 1, min: 1 },
  ackedBy: String,
  ackedAt: Date,
  resolvedAt: Date,
  instanceId: String,
});
// Serves GET /alerts: equality on state/severity, newest first.
alertSchema.index({ state: 1, severity: 1, openedAt: -1 });
alertSchema.index({ openedAt: -1 });
alertSchema.index({ satId: 1, openedAt: -1 });
alertSchema.index({ key: 1 });

export const AlertModel = model<AlertDoc>('Alert', alertSchema);
