import { describe, expect, it } from 'vitest';
import type { AlertRule } from '@orbitops/shared';
import { isFieldApplicable, validateRuleField } from './rules.ts';

describe('validateRuleField', () => {
  it('accepts any finite threshold', () => {
    expect(validateRuleField('threshold', '-125.5')).toEqual({ ok: true, value: -125.5 });
  });
  it('rejects non-numbers and blanks', () => {
    expect(validateRuleField('threshold', 'abc').ok).toBe(false);
    expect(validateRuleField('threshold', '  ').ok).toBe(false);
  });
  it('requires whole numbers within server bounds', () => {
    expect(validateRuleField('samples', '1.5').ok).toBe(false);
    expect(validateRuleField('samples', '0').ok).toBe(false);
    expect(validateRuleField('samples', '10')).toEqual({ ok: true, value: 10 });
    expect(validateRuleField('windowSize', '1').ok).toBe(false);
    expect(validateRuleField('windowSize', '2').ok).toBe(true);
  });
  it('keeps clearRatio strictly positive', () => {
    expect(validateRuleField('clearRatio', '0').ok).toBe(false);
    expect(validateRuleField('clearRatio', '0.9').ok).toBe(true);
  });
});

describe('isFieldApplicable', () => {
  const base: AlertRule = {
    id: 'r',
    name: 'r',
    subsystem: 'EPS',
    severity: 'CAUTION',
    kind: 'threshold',
    metric: 'batSoc',
    op: '<',
    threshold: 1,
    enabled: true,
  };
  it('limits windowSize to windowed detectors and stale rules to the threshold', () => {
    expect(isFieldApplicable(base, 'windowSize')).toBe(false);
    expect(isFieldApplicable({ ...base, kind: 'roc' }, 'windowSize')).toBe(true);
    expect(isFieldApplicable({ ...base, kind: 'stale' }, 'samples')).toBe(false);
    expect(isFieldApplicable({ ...base, kind: 'stale' }, 'threshold')).toBe(true);
  });
});
