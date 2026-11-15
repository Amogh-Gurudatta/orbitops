// Spawns the OrbitOps server as a child process with explicit environment overrides, so every scenario
// runs against a fresh, reproducibly configured instance (same code path as `npm start -w @orbitops/server`).
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { REPO_ROOT } from './api.js';

export interface ServerHandle {
  pid: number;
  url: string;
  /** Log lines (warn and above) the server wrote, kept for scenario evidence. */
  logLines: string[];
  stop(): Promise<void>;
}

export const LOADTEST_ENV = {
  NODE_ENV: 'development',
  MONGODB_URI: 'mongodb://localhost:27017/orbitops_loadtest?replicaSet=rs0&directConnection=true',
  SEED_DEMO: 'true',
  DEVICE_API_KEY: 'dev-simulator-key-change-me',
  LOG_LEVEL: 'warn',
} as const;

/** Rate limits high enough that the device limiter never interferes with throughput measurements. */
export const RAISED_LIMITS = {
  DEVICE_EVENTS_PER_SEC: '1000000',
  DEVICE_BURST_EVENTS: '2000000',
} as const;

async function waitUntilHealthy(
  url: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become healthy within ${timeoutMs} ms`);
}

export async function startServerProcess(
  port: number,
  overrides: Record<string, string> = {},
): Promise<ServerHandle> {
  const url = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: resolve(REPO_ROOT, 'packages/server'),
    env: { ...process.env, ...LOADTEST_ENV, PORT: String(port), ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logLines: string[] = [];
  const capture = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim() && logLines.length < 500) logLines.push(line.trim());
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  try {
    await waitUntilHealthy(url, child, 60_000);
  } catch (err) {
    child.kill('SIGKILL');
    throw new Error(`${(err as Error).message}\n${logLines.slice(-10).join('\n')}`, { cause: err });
  }

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    await exited;
    clearTimeout(timer);
  };
  return { pid: child.pid!, url, logLines, stop };
}
