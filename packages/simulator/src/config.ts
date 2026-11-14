// Simulator configuration, parsed from environment variables (see README / .env.example).

export interface Shard {
  index: number;
  count: number;
}

export interface SimConfig {
  serverUrl: string;
  deviceApiKey: string;
  /** Samples per second per satellite, 1..10. */
  hz: number;
  shard: Shard;
  /** NORAD ids to simulate; empty means "all in the snapshot". */
  satIds: number[];
  /** Simulated seconds per wall-clock second. */
  timeScale: number;
  tleRefresh: boolean;
}

export const MAX_SIM_HZ = 10;

export function parseShard(raw: string): Shard {
  const match = /^(\d+)\/(\d+)$/.exec(raw.trim());
  const index = match ? Number(match[1]) : NaN;
  const count = match ? Number(match[2]) : NaN;
  if (!match || count < 1 || index >= count) {
    throw new Error(`SIM_SHARD must look like "index/count" with index < count, got "${raw}"`);
  }
  return { index, count };
}

export function parseSatIds(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      const id = Number(s);
      if (!Number.isInteger(id) || id < 0) throw new Error(`SIM_SATS: invalid NORAD id "${s}"`);
      return id;
    });
}

function numberOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimConfig {
  const timeScale = numberOr(env['SIM_TIME_SCALE'], 1);
  if (timeScale <= 0) throw new Error('SIM_TIME_SCALE must be > 0');
  return {
    serverUrl: env['SERVER_URL'] || 'http://localhost:4000',
    deviceApiKey: env['DEVICE_API_KEY'] ?? '',
    hz: Math.min(MAX_SIM_HZ, Math.max(1, numberOr(env['SIM_HZ'], 5))),
    shard: parseShard(env['SIM_SHARD'] || '0/1'),
    satIds: parseSatIds(env['SIM_SATS'] ?? ''),
    timeScale,
    tleRefresh: (env['TLE_REFRESH'] ?? 'false').toLowerCase() === 'true',
  };
}
