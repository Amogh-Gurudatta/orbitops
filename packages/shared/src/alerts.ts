// Alert contracts: the alert document, detection rules, and operator actions on alerts.
import { z } from 'zod';
import { SUBSYSTEMS } from './constants.js';
import { TelemetryFrame } from './telemetry.js';

export const SEVERITIES = ['WARNING', 'CAUTION', 'ADVISORY'] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

export const ALERT_STATES = ['open', 'acked', 'resolved'] as const;
export const AlertState = z.enum(ALERT_STATES);
export type AlertState = z.infer<typeof AlertState>;

export const SubsystemEnum = z.enum(SUBSYSTEMS);

/** `${satId}:${ruleId}` - one live alert per satellite per rule. */
export function alertKey(satId: number, ruleId: string): string {
  return `${satId}:${ruleId}`;
}

export const Alert = z.strictObject({
  id: z.string(),
  key: z.string(),
  satId: z.int().min(0),
  ruleId: z.string(),
  subsystem: SubsystemEnum,
  severity: Severity,
  state: AlertState,
  message: z.string(),
  /** Metric value that triggered (or last refreshed) the alert. */
  value: z.number().nullable(),
  threshold: z.number().nullable(),
  /** Epoch milliseconds. */
  openedAt: z.int().min(0),
  lastSeenAt: z.int().min(0),
  count: z.int().min(1),
  ackedBy: z.string().optional(),
  ackedAt: z.int().min(0).optional(),
  resolvedAt: z.int().min(0).optional(),
});
export type Alert = z.infer<typeof Alert>;

export const RULE_KINDS = ['threshold', 'zscore', 'roc', 'stale', 'domain'] as const;
export const RuleKind = z.enum(RULE_KINDS);
export type RuleKind = z.infer<typeof RuleKind>;

const TELEMETRY_METRICS = Object.keys(TelemetryFrame.shape) as [
  keyof TelemetryFrame,
  ...(keyof TelemetryFrame)[],
];

export const AlertRule = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  subsystem: SubsystemEnum,
  severity: Severity,
  kind: RuleKind,
  metric: z.enum(TELEMETRY_METRICS),
  op: z.enum(['>', '<']),
  threshold: z.number(),
  /** Hysteresis: the alert clears once the value recovers past threshold * clearRatio. */
  clearRatio: z.number().positive().optional(),
  /** Consecutive violating samples required before opening. */
  samples: z.int().min(1).optional(),
  /** Rolling window length for zscore / roc detectors. */
  windowSize: z.int().min(2).optional(),
  enabled: z.boolean(),
});
export type AlertRule = z.infer<typeof AlertRule>;

export const AckAlertRequest = z.strictObject({ alertId: z.string().min(1) });
export type AckAlertRequest = z.infer<typeof AckAlertRequest>;

export const ResolveAlertRequest = z.strictObject({
  alertId: z.string().min(1),
  note: z.string().max(500).optional(),
});
export type ResolveAlertRequest = z.infer<typeof ResolveAlertRequest>;
