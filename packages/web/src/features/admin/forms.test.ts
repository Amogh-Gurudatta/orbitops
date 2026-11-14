import { describe, expect, it } from 'vitest';
import { objectIdTime, parseAllowedSources, validateCreateUser } from './forms.ts';

const valid = {
  email: 'new@orbitops.dev',
  name: ' New Op ',
  password: 'longenough',
  role: 'operator',
};

describe('validateCreateUser', () => {
  it('accepts a valid user and trims the name', () => {
    expect(validateCreateUser(valid)).toEqual({
      ok: true,
      value: { ...valid, name: 'New Op' },
    });
  });

  it('reports one message per bad field', () => {
    const result = validateCreateUser({ ...valid, email: 'nope', password: 'short', name: ' ' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.email).toBe('VALID EMAIL REQUIRED');
      expect(result.errors.password).toBe('MINIMUM 8 CHARACTERS');
      expect(result.errors.name).toBe('NAME REQUIRED');
    }
  });

  it('rejects unknown roles', () => {
    expect(validateCreateUser({ ...valid, role: 'root' }).ok).toBe(false);
  });
});

describe('parseAllowedSources', () => {
  it('splits on commas and whitespace', () => {
    expect(parseAllowedSources('sat-1, sat-2  sat-3')).toEqual({
      ok: true,
      value: ['sat-1', 'sat-2', 'sat-3'],
    });
  });
  it('treats blank as every source', () => {
    expect(parseAllowedSources('  ')).toEqual({ ok: true, value: ['*'] });
  });
  it('rejects over-long ids', () => {
    expect(parseAllowedSources('x'.repeat(33)).ok).toBe(false);
  });
});

describe('objectIdTime', () => {
  it('reads the creation time from an ObjectId', () => {
    expect(objectIdTime('6af8c3056ddf5013a699123d')).toBe(0x6af8c305 * 1000);
  });
  it('returns null for non-ids', () => {
    expect(objectIdTime('abc')).toBeNull();
  });
});
