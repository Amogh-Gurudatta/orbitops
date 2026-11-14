import { describe, expect, it } from 'vitest';
import { classifyStatus, fromServerStatus } from './status.ts';

const base = { now: 100_000, staleAfterMs: 15_000 };

describe('classifyStatus', () => {
  it('is NOM with fresh data and no alerts', () => {
    expect(classifyStatus({ ...base, lastSeenAt: 99_000, worstSeverity: null })).toBe('NOM');
  });
  it('maps alert severity to CAUT and WARN', () => {
    expect(classifyStatus({ ...base, lastSeenAt: 99_000, worstSeverity: 'CAUTION' })).toBe('CAUT');
    expect(classifyStatus({ ...base, lastSeenAt: 99_000, worstSeverity: 'WARNING' })).toBe('WARN');
  });
  it('treats advisory alerts as nominal', () => {
    expect(classifyStatus({ ...base, lastSeenAt: 99_000, worstSeverity: 'ADVISORY' })).toBe('NOM');
  });
  it('is STALE when no frame arrived within the threshold, even with a warning', () => {
    expect(classifyStatus({ ...base, lastSeenAt: 80_000, worstSeverity: 'WARNING' })).toBe('STALE');
  });
  it('does not mark never-seen satellites stale', () => {
    expect(classifyStatus({ ...base, lastSeenAt: undefined, worstSeverity: null })).toBe('NOM');
  });
  it('is not stale exactly at the threshold', () => {
    expect(classifyStatus({ ...base, lastSeenAt: 85_000, worstSeverity: null })).toBe('NOM');
  });
});

describe('fromServerStatus', () => {
  it('maps catalogue statuses', () => {
    expect(fromServerStatus('NOMINAL')).toBe('NOM');
    expect(fromServerStatus('CAUTION')).toBe('CAUT');
    expect(fromServerStatus('WARNING')).toBe('WARN');
    expect(fromServerStatus('STALE')).toBe('STALE');
  });
});
