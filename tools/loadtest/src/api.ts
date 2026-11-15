// Small REST helpers shared by the load generators: demo login, server stats and the satellite catalogue.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PipelineStats } from './stats.js';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const DEMO_EMAIL = 'viewer@orbitops.dev';
export const DEMO_PASSWORD = 'orbitops';
export const DEV_DEVICE_KEY = 'dev-simulator-key-change-me';

/**
 * Logs in once and returns the 15-minute access JWT.
 * The server limits logins to 5/minute/IP, so a swarm cannot log in per client: every virtual
 * viewer shares this one token as its Socket.IO `auth.token` (the server verifies it per handshake).
 */
export async function login(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  for (const cookie of res.headers.getSetCookie()) {
    const match = /^oo_at=([^;]+)/.exec(cookie);
    if (match?.[1]) return match[1];
  }
  throw new Error('login response carried no oo_at cookie');
}

export async function fetchStats(baseUrl: string, token: string): Promise<PipelineStats> {
  const res = await fetch(`${baseUrl}/api/v1/system/stats`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`stats failed: HTTP ${res.status}`);
  return (await res.json()) as PipelineStats;
}

/** NORAD ids the seeded server accepts as ingest sources (same file the seeder reads). */
export async function catalogueSatIds(): Promise<number[]> {
  const raw = await readFile(resolve(REPO_ROOT, 'data/satellites.json'), 'utf8');
  const { satellites } = JSON.parse(raw) as { satellites: { noradId: number }[] };
  return satellites.map((s) => s.noradId);
}
