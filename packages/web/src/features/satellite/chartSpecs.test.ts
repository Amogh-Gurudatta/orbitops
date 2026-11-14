import { describe, expect, it } from 'vitest';
import { CHART_SPECS, HISTORY_METRICS, limitState } from './chartSpecs.ts';

describe('limitState', () => {
  const soc = CHART_SPECS.batSoc.limits;
  it('flags low battery caution then warning (lower limits)', () => {
    expect(limitState(55, soc)).toBe('nominal');
    expect(limitState(20, soc)).toBe('caution');
    expect(limitState(15, soc)).toBe('caution');
    expect(limitState(10, soc)).toBe('warning');
  });

  it('flags high temperature against upper limits', () => {
    const t = CHART_SPECS.panelTempC.limits;
    expect(limitState(69.9, t)).toBe('nominal');
    expect(limitState(70, t)).toBe('caution');
    expect(limitState(90, t)).toBe('warning');
  });

  it('treats missing values and missing limits as nominal', () => {
    expect(limitState(null, soc)).toBe('nominal');
    expect(limitState(NaN, soc)).toBe('nominal');
    expect(limitState(5, undefined)).toBe('nominal');
  });

  it('plots battery state of charge as a percentage', () => {
    expect(CHART_SPECS.batSoc.factor).toBe(100);
    expect(CHART_SPECS.batSoc.unit).toBe('%');
  });

  it('requests every charted metric from history', () => {
    expect(HISTORY_METRICS).toContain('batSoc');
    expect(HISTORY_METRICS).toContain('attRateDps');
    expect(new Set(HISTORY_METRICS).size).toBe(HISTORY_METRICS.length);
  });
});
