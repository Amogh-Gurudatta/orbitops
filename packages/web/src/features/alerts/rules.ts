// Validation for the inline alert-rule editor. Mirrors the server's AlertRule constraints so an
// invalid edit is rejected before the request is made.
import type { AlertRule } from '@orbitops/shared';

export type EditableNumberField = 'threshold' | 'samples' | 'clearRatio' | 'windowSize';

export type FieldResult = { ok: true; value: number } | { ok: false; error: string };

const RULES: Record<
  EditableNumberField,
  { integer: boolean; min?: number; exclusiveMin?: number }
> = {
  threshold: { integer: false },
  samples: { integer: true, min: 1 },
  clearRatio: { integer: false, exclusiveMin: 0 },
  windowSize: { integer: true, min: 2 },
};

export function validateRuleField(field: EditableNumberField, raw: string): FieldResult {
  const text = raw.trim();
  const value = Number(text);
  if (text === '' || !Number.isFinite(value)) return { ok: false, error: 'NOT A NUMBER' };
  const rule = RULES[field];
  if (rule.integer && !Number.isInteger(value))
    return { ok: false, error: 'WHOLE NUMBER REQUIRED' };
  if (rule.min !== undefined && value < rule.min)
    return { ok: false, error: `MINIMUM ${rule.min}` };
  if (rule.exclusiveMin !== undefined && value <= rule.exclusiveMin)
    return { ok: false, error: `MUST BE ABOVE ${rule.exclusiveMin}` };
  return { ok: true, value };
}

/** Whether a tuning field means anything for a detector kind (n/a cells render as a dash). */
export function isFieldApplicable(rule: AlertRule, field: EditableNumberField): boolean {
  if (rule.kind === 'stale') return field === 'threshold';
  if (field === 'windowSize') return rule.kind === 'zscore' || rule.kind === 'roc';
  return true;
}
