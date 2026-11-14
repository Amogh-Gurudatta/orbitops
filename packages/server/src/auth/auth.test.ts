import { describe, expect, it } from 'vitest';
import { parseCookieHeader } from './cookies.js';
import {
  authenticateDeviceKey,
  hashDeviceKey,
  mayPublish,
  type StoredDevice,
} from './deviceKey.js';
import { hashPassword, verifyPassword } from './password.js';
import { createTokenService, type AuthUser } from './tokens.js';

const user: AuthUser = { id: 'u1', email: 'a@b.dev', name: 'A', role: 'operator' };
const SECRET = 's'.repeat(40);

describe('tokens', () => {
  const tokens = createTokenService(SECRET);

  it('round-trips a user for the matching token use only', async () => {
    const access = await tokens.sign('access', user);
    expect(await tokens.verify(access, 'access')).toEqual(user);
    expect(await tokens.verify(access, 'refresh')).toBeNull();
    expect(await tokens.verify(access, 'socket')).toBeNull();
  });

  it('rejects tampered, foreign-secret and missing tokens', async () => {
    const token = await tokens.sign('access', user);
    expect(await tokens.verify(`${token}x`, 'access')).toBeNull();
    expect(await createTokenService('z'.repeat(40)).verify(token, 'access')).toBeNull();
    expect(await tokens.verify(undefined, 'access')).toBeNull();
    expect(await tokens.verify('garbage', 'access')).toBeNull();
  });
});

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('orbitops');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'orbitops')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'orbitops')).toBe(false);
  });
});

describe('device keys', () => {
  const key = 'dev-simulator-key-change-me';
  const stored: StoredDevice = {
    id: 'd1',
    name: 'sim',
    keyHash: hashDeviceKey(key),
    allowedSources: ['sat-1'],
  };
  const lookup = async (hash: string) => (hash === stored.keyHash ? stored : null);

  it('authenticates a known key and rejects others', async () => {
    expect(await authenticateDeviceKey(key, lookup)).toMatchObject({ id: 'd1', name: 'sim' });
    expect(await authenticateDeviceKey('another-key-123', lookup)).toBeNull();
    expect(await authenticateDeviceKey(undefined, lookup)).toBeNull();
    expect(await authenticateDeviceKey(42, lookup)).toBeNull();
    expect(await authenticateDeviceKey('x'.repeat(300), lookup)).toBeNull();
  });

  it('enforces the source allow-list', () => {
    expect(mayPublish({ id: 'd', name: 'n', allowedSources: ['*'] }, 'sat-9')).toBe(true);
    expect(mayPublish({ id: 'd', name: 'n', allowedSources: ['sat-1'] }, 'sat-1')).toBe(true);
    expect(mayPublish({ id: 'd', name: 'n', allowedSources: ['sat-1'] }, 'sat-2')).toBe(false);
  });
});

describe('parseCookieHeader', () => {
  it('parses, decodes and keeps the first duplicate', () => {
    expect(parseCookieHeader('a=1; oo_at=tok%20en; a=2; bad')).toEqual({ a: '1', oo_at: 'tok en' });
    expect(parseCookieHeader(undefined)).toEqual({});
  });
});
