import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies development defaults with warnings', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4000);
    expect(config.persistHz).toBe(2);
    expect(config.rawTtlHours).toBe(6);
    expect(config.seedDemo).toBe(true);
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.warnings.length).toBeGreaterThan(0);
  });

  it('requires a strong JWT secret in production and disables demo seeding by default', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) });
    expect(config.seedDemo).toBe(false);
    expect(config.deviceApiKey).toBeUndefined();
  });

  it('parses booleans, numbers and origin lists', () => {
    const config = loadConfig({
      SERVE_WEB: 'true',
      SEED_DEMO: 'false',
      PORT: '8080',
      PERSIST_HZ: '5',
      CLIENT_ORIGIN: 'http://a.test, http://b.test',
    });
    expect(config).toMatchObject({ serveWeb: true, seedDemo: false, port: 8080, persistHz: 5 });
    expect(config.clientOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
