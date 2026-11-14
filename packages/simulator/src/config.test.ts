import { describe, expect, it } from 'vitest';
import { loadConfig, parseShard } from './config.js';

describe('config', () => {
  it('uses documented defaults', () => {
    expect(loadConfig({})).toEqual({
      serverUrl: 'http://localhost:4000',
      deviceApiKey: '',
      hz: 5,
      shard: { index: 0, count: 1 },
      satIds: [],
      timeScale: 1,
      tleRefresh: false,
    });
  });

  it('parses overrides and clamps SIM_HZ to 1..10', () => {
    const config = loadConfig({
      SERVER_URL: 'http://x:1',
      DEVICE_API_KEY: 'k',
      SIM_HZ: '50',
      SIM_SHARD: '1/3',
      SIM_SATS: '25544, 48274',
      SIM_TIME_SCALE: '60',
      TLE_REFRESH: 'true',
    });
    expect(config).toMatchObject({
      hz: 10,
      shard: { index: 1, count: 3 },
      satIds: [25544, 48274],
      timeScale: 60,
      tleRefresh: true,
    });
  });

  it('rejects invalid shards and ids', () => {
    expect(() => parseShard('3/3')).toThrow();
    expect(() => parseShard('a/b')).toThrow();
    expect(() => loadConfig({ SIM_SATS: 'abc' })).toThrow();
    expect(() => loadConfig({ SIM_TIME_SCALE: '0' })).toThrow();
  });
});
