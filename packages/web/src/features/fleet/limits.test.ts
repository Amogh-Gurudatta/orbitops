import { describe, expect, it } from 'vitest';
import { limitState } from './limits.ts';

describe('limitState', () => {
  it('flags low battery in two bands', () => {
    expect(limitState('batSoc', 0.5)).toBe('nominal');
    expect(limitState('batSoc', 0.15)).toBe('caution');
    expect(limitState('batSoc', 0.05)).toBe('warning');
  });

  it('flags high panel temperature in two bands', () => {
    expect(limitState('panelTempC', 60)).toBe('nominal');
    expect(limitState('panelTempC', 75)).toBe('caution');
    expect(limitState('panelTempC', 90)).toBe('warning');
  });

  it('uses a single caution band where the server has one rule', () => {
    expect(limitState('obcTempC', 56)).toBe('caution');
    expect(limitState('busA', 3.9)).toBe('nominal');
  });

  it('treats missing data as nominal', () => {
    expect(limitState('rssiDbm', null)).toBe('nominal');
    expect(limitState('batSoc', undefined)).toBe('nominal');
    expect(limitState('batSoc', Number.NaN)).toBe('nominal');
  });
});
